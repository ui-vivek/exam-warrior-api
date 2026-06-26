import mongoose from 'mongoose';
import { User } from '@/model/user.model';
import { Referral } from '@/model/referral.model';
import { UserDevice } from '@/model/userDevice.model';
import { Test } from '@/model/test.model';
import { sendPushToUsers } from '@/services/pushService';

/* ----------------------------------------------------------------------------
 * Tunables. Days are near-zero marginal cost (AI questions are cheap), so we can
 * be generous — but the LIFETIME cap keeps the reward economy bounded. The cap
 * is INTERNAL: it is never returned to the client, so users keep inviting.
 * -------------------------------------------------------------------------- */
export const REWARD_DAYS_REFERRER = 15; // referrer earns this per friend who converts
export const REWARD_DAYS_REFEREE = 15;  // the friend earns this on their first test
export const REFERRAL_LIFETIME_CAP_DAYS = 45; // silent per-account lifetime cap
export const DAILY_REFERRAL_REWARD_CAP = 5;   // max friends that can earn a referrer days / 24h

const DAY_MS = 24 * 60 * 60 * 1000;

/** Public web base used to build a shareable link (deep-link-ready later). */
const WEB_BASE = (process.env.REFERRAL_WEB_BASE || 'https://examwarrior.app').replace(/\/+$/, '');

/* ------------------------------- code helpers ----------------------------- */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous O/0/I/1

function randomCode(seed?: string): string {
  // Up to 4 letters from the name (if any) + 4 random chars → e.g. AMIT7K3Q.
  const prefix = (seed || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4) || 'EW';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}${rand}`;
}

/** Generates a referral code that isn't already taken. */
export async function generateUniqueReferralCode(seed?: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode(seed);
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  // Extremely unlikely fallback: guaranteed-unique suffix.
  return `EW${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Returns the user's referral code, generating + persisting one if missing.
 * Collision-safe: the `referralCode` field is uniquely indexed, so a save could
 * still throw a duplicate-key error if two new users happen to mint the same
 * code at the same instant. We catch that and retry with a fresh code rather
 * than letting it bubble up (which, at signup, would break the user's login).
 */
export async function ensureReferralCode(user: any): Promise<string> {
  if (user.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = await generateUniqueReferralCode(user.name);
    user.referralCode = code;
    try {
      await user.save();
      return code;
    } catch (err: any) {
      if (err?.code === 11000) {
        user.referralCode = undefined; // collided — try a new one
        continue;
      }
      throw err;
    }
  }

  // Extremely unlikely fallback: a guaranteed-unique, time-based code.
  user.referralCode = `EW${Date.now().toString(36).toUpperCase()}`;
  await user.save();
  return user.referralCode;
}

/* ----------------------------- apply at signup ---------------------------- */

/**
 * Links a brand-new user to the referrer whose code they used. Records a
 * 'registered' referral; no reward is granted yet (that happens on the friend's
 * first daily test). Safe to call with a missing/invalid code — it just no-ops.
 */
export async function applyReferralAtSignup(opts: {
  newUser: any;
  code?: string | null;
  deviceId?: string | null;
  ip?: string | null;
}): Promise<void> {
  const raw = (opts.code || '').trim().toUpperCase();
  if (!raw) return;

  const referrer = await User.findOne({ referralCode: raw }).select('_id');
  if (!referrer) return; // invalid code — ignore silently
  if (referrer._id.equals(opts.newUser._id)) return; // can't refer yourself

  try {
    await Referral.create({
      referrerId: referrer._id,
      refereeId: opts.newUser._id,
      code: raw,
      status: 'registered',
      signupDeviceId: opts.deviceId || undefined,
      signupIp: opts.ip || undefined,
    });
    opts.newUser.referredBy = referrer._id;
    await opts.newUser.save();
  } catch (err: any) {
    // Duplicate refereeId (already referred) — ignore.
    if (err?.code !== 11000) console.error('[referral] applyReferralAtSignup', err?.message);
  }
}

/* ------------------------------ grant helper ------------------------------ */

/**
 * Extends a user's premium by up to `requestedDays`, respecting the silent
 * lifetime cap. Mutates the doc (caller persists). Returns the days ACTUALLY
 * granted (0 once the account has hit the cap).
 */
function grantReferralDays(user: any, requestedDays: number): number {
  const already = user.referralRewardDays || 0;
  const remaining = Math.max(0, REFERRAL_LIFETIME_CAP_DAYS - already);
  const grant = Math.min(requestedDays, remaining);
  if (grant <= 0) return 0;

  const now = new Date();
  const hasFuture = user.subscriptionEndDate && new Date(user.subscriptionEndDate) > now;
  const base = hasFuture ? new Date(user.subscriptionEndDate) : now;
  user.subscriptionEndDate = new Date(base.getTime() + grant * DAY_MS);
  user.subscriptionStatus = 'active';
  user.referralRewardDays = already + grant;
  return grant;
}

/* ------------------------- reward on first test --------------------------- */

/**
 * Called after a user submits their FIRST daily test. If they were referred and
 * the referral hasn't been settled yet, runs fraud checks and credits both
 * sides with free premium days. Idempotent + concurrency-safe (atomic claim).
 * Best-effort: never throws into the test-submit path.
 */
export async function creditReferralOnFirstTest(
  refereeId: string,
  ctx: { deviceId?: string | null; ip?: string | null } = {},
): Promise<void> {
  try {
    const pending = await Referral.findOne({ refereeId, status: 'registered' });
    if (!pending) return;

    // Atomically claim so two concurrent submits can't both reward.
    const claimed = await Referral.findOneAndUpdate(
      { _id: pending._id, status: 'registered' },
      { status: 'active', rewardedAt: new Date() },
      { new: true },
    );
    if (!claimed) return; // someone else already processed it

    const referrer = await User.findById(claimed.referrerId);
    const referee = await User.findById(refereeId);
    if (!referrer || !referee) {
      claimed.status = 'blocked';
      claimed.blockedReason = 'missing_user';
      await claimed.save();
      return;
    }

    // --- Fraud check: self-referral (hard block, no reward to anyone) ---
    if (referrer._id.equals(referee._id)) {
      claimed.status = 'blocked';
      claimed.blockedReason = 'self_referral';
      await claimed.save();
      return;
    }

    // --- Fraud check: same physical device (hard block) ---
    // IP is deliberately NOT used as a blocker: coaching centres, hostels and
    // CGNAT mean many legitimate friends share one IP. Device identity is the
    // signal that actually indicates one person making two accounts.
    const devId = claimed.signupDeviceId || ctx.deviceId;
    if (devId) {
      // (a) The friend signed up on a device already registered to the referrer
      //     (needs push/FCM, so empty until that's live).
      const sharedDevice = await UserDevice.exists({ userId: referrer._id, deviceId: devId });
      // (b) The SAME device has already earned this referrer a reward — classic
      //     one-phone farming. Works today, with no dependency on push tokens.
      const deviceAlreadyUsed = await Referral.exists({
        referrerId: referrer._id,
        signupDeviceId: devId,
        status: 'active',
        _id: { $ne: claimed._id },
      });
      if (sharedDevice || deviceAlreadyUsed) {
        claimed.status = 'blocked';
        claimed.blockedReason = 'device_match';
        await claimed.save();
        return;
      }
    }

    // --- Soft cap: velocity. Over the daily cap, the FRIEND still earns their
    // bonus (they're a real student), but the referrer earns 0 for this one. ---
    const since = new Date(Date.now() - DAY_MS);
    const rewardedToday = await Referral.countDocuments({
      referrerId: referrer._id,
      status: 'active',
      rewardDaysReferrer: { $gt: 0 },
      rewardedAt: { $gte: since },
    });
    const referrerEligible = rewardedToday < DAILY_REFERRAL_REWARD_CAP;

    // --- Grant days (each side bounded by the silent lifetime cap) ---
    const refereeDays = grantReferralDays(referee, REWARD_DAYS_REFEREE);
    await referee.save();

    let referrerDays = 0;
    if (referrerEligible) {
      referrerDays = grantReferralDays(referrer, REWARD_DAYS_REFERRER);
      if (referrerDays > 0) await referrer.save();
    }

    claimed.rewardDaysReferrer = referrerDays;
    claimed.rewardDaysReferee = refereeDays;
    if (!referrerEligible) claimed.blockedReason = 'velocity_cap';
    await claimed.save();

    // Best-effort, language-aware nudges to both sides.
    notifyReward(referrer, referrerDays, 'referrer').catch(() => {});
    notifyReward(referee, refereeDays, 'referee').catch(() => {});
  } catch (err: any) {
    console.error('[referral] creditReferralOnFirstTest', err?.message);
  }
}

/* ------------------------------ notifications ----------------------------- */

async function notifyReward(user: any, days: number, role: 'referrer' | 'referee') {
  if (!days || days <= 0) return;
  const hi = (user.appLanguage || 'english') === 'hindi';
  const title = hi ? `🎉 ${days} din free premium mile!` : `🎉 You earned ${days} free days!`;
  const body = role === 'referrer'
    ? (hi
      ? 'Aapke dost ne pehla test diya. Aur doston ko refer karke aur din kamayein!'
      : 'Your friend took their first test. Refer more friends to earn more days!')
    : (hi
      ? 'Welcome! Aapko bonus premium din mile. Roz test dekar aage badhein.'
      : 'Welcome! Your bonus premium days are added. Keep practising daily.');
  await sendPushToUsers([user._id.toString()], {
    title, body, data: { type: 'referral' }, channelId: 'updates',
  });
}

/* ------------------------------- overview --------------------------------- */

const BADGES: { min: number; en: string; hi: string }[] = [
  { min: 25, en: 'Mentor', hi: 'मेंटर' },
  { min: 10, en: 'Gold', hi: 'गोल्ड' },
  { min: 5, en: 'Silver', hi: 'सिल्वर' },
  { min: 3, en: 'Bronze', hi: 'ब्रॉन्ज़' },
  { min: 1, en: 'Starter', hi: 'स्टार्टर' },
];

function badgeFor(joined: number, hi: boolean): string | null {
  const b = BADGES.find((x) => joined >= x.min);
  return b ? (hi ? b.hi : b.en) : null;
}

function maskName(referee: any): string {
  if (referee?.name && referee.name.trim()) return referee.name.trim();
  const p = String(referee?.phone || '');
  return p ? `Warrior •${p.slice(-4)}` : 'Warrior';
}

/**
 * Everything the Refer & Earn screen needs: the user's code, a ready-to-share
 * link + message (localised to their app language), aggregate stats and the
 * list of invited friends with their status. Never exposes the lifetime cap.
 */
export async function getReferralOverview(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new Error('user_not_found');

  const code = await ensureReferralCode(user);
  const hi = (user.appLanguage || 'english') === 'hindi';
  const shareUrl = `${WEB_BASE}/r/${code}`;
  const shareMessage = hi
    ? `📚 Exam Warrior par roz AI mock test do aur apni kamzor topics sudharo! Mere code se join karo — dono ko ${REWARD_DAYS_REFEREE} din free premium milega 🎁\n${shareUrl}`
    : `📚 Crack your govt exam with daily AI mock tests on Exam Warrior! Join with my code — we BOTH get ${REWARD_DAYS_REFEREE} days free premium 🎁\n${shareUrl}`;

  const referrals = await Referral.find({ referrerId: userId })
    .sort({ createdAt: -1 })
    .populate('refereeId', 'name phone')
    .lean();

  const friends = referrals.map((r: any) => ({
    name: maskName(r.refereeId),
    // 'active' (took first test → you earned days) vs 'registered' (joined, not
    // tested yet). 'blocked' is hidden as 'registered' so we don't reveal fraud
    // logic to the user.
    status: r.status === 'active' ? 'active' : 'registered',
    joinedAt: r.createdAt,
  }));

  const totalJoined = friends.filter((f) => f.status === 'active').length;
  const daysEarned = referrals.reduce((sum: number, r: any) => sum + (r.rewardDaysReferrer || 0), 0);

  return {
    code,
    shareUrl,
    shareMessage,
    perReferralDays: REWARD_DAYS_REFERRER,
    refereeBonusDays: REWARD_DAYS_REFEREE,
    totalInvited: friends.length,
    totalJoined,
    daysEarned,
    badge: badgeFor(totalJoined, hi),
    friends,
  };
}

/* --------------------------- validate / apply ----------------------------- */

/** Display name for a referrer — their name, or null (UI shows a generic ✓). */
function referrerDisplay(u: any): string | null {
  return u?.name && u.name.trim() ? u.name.trim() : null;
}

/**
 * Live check for the onboarding screen: is this a real, usable referral code?
 * `requestingUserId` lets us reject the user's own code.
 */
export async function validateReferralCode(code: string, requestingUserId?: string) {
  const raw = (code || '').trim().toUpperCase();
  if (!raw) return { valid: false };

  const referrer = await User.findOne({ referralCode: raw }).select('_id name');
  if (!referrer) return { valid: false };
  if (requestingUserId && referrer._id.equals(requestingUserId)) {
    return { valid: false, self: true };
  }
  return { valid: true, referrerName: referrerDisplay(referrer) };
}

/**
 * Applies a referral code to an existing (new) account from the onboarding
 * screen — the post-signup equivalent of applyReferralAtSignup. Guards against
 * retro-claiming: only before the user has taken any daily test, and only once.
 */
export async function applyReferralCode(opts: {
  userId: string;
  code: string;
  deviceId?: string | null;
  ip?: string | null;
}) {
  const raw = (opts.code || '').trim().toUpperCase();
  if (!raw) return { applied: false, reason: 'empty' as const };

  const user = await User.findById(opts.userId);
  if (!user) return { applied: false, reason: 'user_not_found' as const };

  // Already linked — idempotent success (don't allow switching referrers).
  if (user.referredBy) {
    const existing = await Referral.findOne({ refereeId: user._id })
      .populate('referrerId', 'name')
      .lean();
    return {
      applied: true,
      alreadyApplied: true,
      referrerName: existing ? referrerDisplay((existing as any).referrerId) : null,
    };
  }

  // A referral can only be claimed before the first daily test — stops existing,
  // active users from retro-adding a code.
  const tookDaily = await Test.exists({
    userId: user._id,
    type: { $ne: 'practice' },
    completed: true,
  });
  if (tookDaily) return { applied: false, reason: 'window_closed' as const };

  const referrer = await User.findOne({ referralCode: raw }).select('_id name');
  if (!referrer) return { applied: false, reason: 'invalid' as const };
  if (referrer._id.equals(user._id)) return { applied: false, reason: 'self' as const };

  try {
    await Referral.create({
      referrerId: referrer._id,
      refereeId: user._id,
      code: raw,
      status: 'registered',
      signupDeviceId: opts.deviceId || undefined,
      signupIp: opts.ip || undefined,
    });
    user.referredBy = referrer._id;
    await user.save();
    return { applied: true, referrerName: referrerDisplay(referrer) };
  } catch (err: any) {
    if (err?.code === 11000) return { applied: true, alreadyApplied: true };
    console.error('[referral] applyReferralCode', err?.message);
    return { applied: false, reason: 'error' as const };
  }
}
