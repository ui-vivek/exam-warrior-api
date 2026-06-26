import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { getMessage } from '@/utils/messages';
import { LangRequest } from '@/middleware/languageMiddleware';
import mongoose from 'mongoose';
import { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest } from '@/middleware/authMiddleware';
import { User } from '@/model/user.model';
import { Payment } from '@/model/payment.model';
import { Subscription } from '@/model/subscription.model';
import {
  getRazorpay,
  validateVpa as razorpayValidateVpa,
  createUpiAutopayCharge,
  createUpiIntentCharge,
  isS2SUnavailable,
  razorpayErrorInfo,
} from '@/utils/razorpay';
import { notifyPaymentEvent } from '@/services/notificationService';

// Basic VPA format check (e.g. "name@bank"). Razorpay does the real validation;
// this just rejects obviously malformed input before we hit the API.
const VPA_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

// First-cycle charge amount (in paise) used for the UPI Autopay mandate
// authorization. Mirrors the public pricing: ₹99/mo and ₹799/yr.
const PLAN_AMOUNT_PAISE: Record<string, number> = {
  monthly: 9900,
  yearly: 79900,
};

/**
 * POST /payments/create-subscription
 * Creates a Razorpay subscription for the authenticated user.
 */
export const createSubscription = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  // Check if user already has an active subscription to avoid double charging
  const existingUser = await User.findById(userId);
  if (existingUser?.subscriptionStatus === 'active') {
    throw new AppError('already_active_sub', 400);
  }

  const { planType } = req.body; // 'monthly' or 'yearly'

  if (!planType || !['monthly', 'yearly'].includes(planType)) {
    throw new AppError('invalid_plan_type', 400);
  }

  const planId = planType === 'monthly'
    ? process.env.RAZORPAY_PLAN_MONTHLY
    : process.env.RAZORPAY_PLAN_YEARLY;

  if (!planId) {
    throw new AppError('Plan not configured on server', 500);
  }

  // Resume a recent pending order ONLY if it is for the SAME plan the user is
  // requesting now. Switching plans (e.g. monthly -> yearly) must start a fresh
  // subscription, otherwise the user would be shown the old plan's amount.
  const pendingPayment = await Payment.findOne({
    userId,
    status: 'created',
    planType,
    createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
  });

  if (pendingPayment?.razorpaySubscriptionId) {
    try {
      const existing: any = await getRazorpay()
        .subscriptions.fetch(pendingPayment.razorpaySubscriptionId);
      // Double-check the live subscription is for this exact plan and is still
      // awaiting authorisation before resuming it.
      if (
        existing &&
        existing.plan_id === planId &&
        (existing.status === 'created' || existing.status === 'authenticated')
      ) {
        return res.json({
          success: true,
          data: {
            subscriptionId: existing.id,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            shortUrl: existing.short_url,
          },
        });
      }
    } catch (_e) {
      // Couldn't fetch it — fall through and create a fresh order.
    }
  }

  const razorpay = getRazorpay();

  // Create subscription via Razorpay API.
  // total_count is the max number of billing cycles Razorpay will auto-charge.
  // Razorpay requires a finite cap, so we set it high enough to act as
  // "renew until the user cancels": ~10 years of monthly, 10 years of yearly.
  const subscription = await razorpay.subscriptions.create({
    plan_id: planId,
    customer_notify: 1,
    total_count: planType === 'monthly' ? 120 : 10,
    // Attach our internal user id + phone so every subscription is traceable
    // back to the app user in the Razorpay dashboard and in webhook payloads.
    notes: {
      app_user_id: String(userId),
      phone: existingUser?.phone ?? '',
      plan_type: planType,
    },
  });

  // Create Subscription record in MongoDB
  const subRecord = await Subscription.create({
    userId,
    razorpaySubscriptionId: subscription.id,
    planId,
    planType,
    status: 'created',
  });

  // Save subscription ID to User
  await User.findByIdAndUpdate(userId, {
    razorpaySubId: subscription.id,
    subscriptionId: subRecord._id,
  });

  // Save payment record in MongoDB (Initial record)
  await Payment.create({
    userId,
    razorpaySubscriptionId: subscription.id,
    planId,
    planType,
    status: 'created',
  });

  res.json({
    success: true,
    data: {
      subscriptionId: subscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      // Razorpay-hosted checkout page; opening this lets the user pay without
      // bundling the native checkout SDK. The webhook activates on success.
      shortUrl: (subscription as any).short_url,
    },
  });
});

/**
 * POST /payments/verify
 * Verifies Razorpay payment signature after checkout and activates subscription.
 */
export const verifyPayment = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_signature,
  } = req.body;

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    throw new AppError('Missing payment verification fields', 400);
  }

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    // Mark payment as failed
    await Payment.findOneAndUpdate(
      { razorpaySubscriptionId: razorpay_subscription_id },
      { status: 'failed' }
    );
    throw new AppError('invalid_signature', 400);
  }

  // Fetch subscription details from Razorpay for amount
  const razorpay = getRazorpay();
  let subscriptionDetails: any;
  try {
    subscriptionDetails = await razorpay.subscriptions.fetch(razorpay_subscription_id);
  } catch (e) {
    console.error('[Payment] Could not fetch subscription details:', e);
  }

  // Determine subscription duration
  const planType = subscriptionDetails?.plan_id === process.env.RAZORPAY_PLAN_YEARLY ? 'yearly' : 'monthly';
  const durationMonths = planType === 'yearly' ? 12 : 1;
  const subscriptionEndDate = new Date();
  subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + durationMonths);

  // Update payment record
  await Payment.findOneAndUpdate(
    { razorpaySubscriptionId: razorpay_subscription_id },
    {
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      amount: subscriptionDetails?.plan?.item?.amount, // in paise
      status: 'active',
      paidAt: new Date(),
    }
  );

  // Update Subscription record
  await Subscription.findOneAndUpdate(
    { razorpaySubscriptionId: razorpay_subscription_id },
    {
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: subscriptionEndDate,
    }
  );

  // Activate user subscription
  await User.findByIdAndUpdate(userId, {
    subscriptionStatus: 'active',
    subscriptionEndDate,
    razorpaySubId: razorpay_subscription_id,
  });

  res.json({
    success: true,
    message: getMessage('payment_verified', req.lang),
    data: {
      subscriptionStatus: 'active',
      subscriptionEndDate,
    },
  });
});

/**
 * POST /payments/validate-vpa
 * Validates a user-typed UPI ID (VPA) via Razorpay's S2S VPA validation API so
 * the custom checkout can show "✓ Verified: <name>" before charging.
 *
 * Always responds 200 with an `available` flag: when S2S/Custom Checkout is not
 * enabled on the account (ticket #19494787), `available` is false and the app
 * falls back to Razorpay's hosted checkout instead of erroring out.
 */
export const validateVpa = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const vpa = String(req.body?.vpa ?? '').trim().toLowerCase();
  if (!VPA_REGEX.test(vpa)) {
    throw new AppError('invalid_vpa', 400, 'invalid_vpa');
  }

  try {
    const result: any = await razorpayValidateVpa(vpa);
    return res.json({
      success: true,
      data: {
        available: true,
        valid: !!result?.success,
        vpa: result?.vpa ?? vpa,
        customerName: result?.customer_name ?? null,
      },
    });
  } catch (err: any) {
    const info = razorpayErrorInfo(err);
    if (isS2SUnavailable(err)) {
      console.warn('[Payment] VPA validation unavailable (S2S not enabled):', info.description);
      // Not an error for the user — signal the app to use the hosted fallback.
      return res.json({ success: true, data: { available: false, valid: false, vpa } });
    }
    console.error('[Payment] VPA validation error:', info);
    // A real validation failure (e.g. malformed/unknown VPA at Razorpay).
    return res.json({ success: true, data: { available: true, valid: false, vpa } });
  }
});

/**
 * POST /payments/upi/autopay
 * Initiates a UPI Autopay (recurring e-mandate) authorization against a typed
 * VPA for an already-created subscription. The user approves the mandate in
 * their UPI app; the webhook is the trusted source that activates Premium.
 *
 * Body: { subscriptionId, vpa }. Responds 200 with an `available` flag so the
 * app can fall back to hosted checkout when S2S is not enabled.
 */
export const initiateUpiAutopay = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const subscriptionId = String(req.body?.subscriptionId ?? '').trim();
  const vpa = String(req.body?.vpa ?? '').trim().toLowerCase();

  if (!subscriptionId) throw new AppError('subscription_not_found', 400, 'subscription_not_found');
  if (!VPA_REGEX.test(vpa)) throw new AppError('invalid_vpa', 400, 'invalid_vpa');

  // The subscription must belong to this user (created via create-subscription).
  const payment = await Payment.findOne({ userId, razorpaySubscriptionId: subscriptionId });
  if (!payment) throw new AppError('subscription_not_found', 404, 'subscription_not_found');

  const planType = payment.planType || 'monthly';
  const amount = PLAN_AMOUNT_PAISE[planType] ?? PLAN_AMOUNT_PAISE.monthly;

  const user = await User.findById(userId);
  const phone = user?.phone ?? '';
  const email = phone ? `${phone}@examwarrior.app` : 'user@examwarrior.app';

  try {
    const result: any = await createUpiAutopayCharge({
      amount,
      email,
      contact: phone,
      subscriptionId,
      vpa,
      ip: req.ip,
      referer: (req.headers['referer'] as string) || 'https://examwarrior.in',
      userAgent: (req.headers['user-agent'] as string) || 'ExamWarriorApp',
    });

    // Mark the pending payment as UPI so history/analytics reflect the method.
    await Payment.updateOne(
      { _id: payment._id },
      { method: 'upi', razorpayPaymentId: result?.razorpay_payment_id ?? payment.razorpayPaymentId },
    );

    return res.json({
      success: true,
      data: {
        available: true,
        status: 'pending', // awaiting mandate approval in the user's UPI app
        paymentId: result?.razorpay_payment_id ?? null,
        message: getMessage('upi_mandate_pending', req.lang),
      },
    });
  } catch (err: any) {
    const info = razorpayErrorInfo(err);
    if (isS2SUnavailable(err)) {
      console.warn('[Payment] UPI Autopay unavailable (S2S not enabled):', info.description);
      return res.json({ success: true, data: { available: false, status: 'unavailable' } });
    }
    console.error('[Payment] UPI Autopay error:', info);
    throw new AppError('upi_autopay_failed', 400, 'upi_autopay_failed');
  }
});

/**
 * POST /payments/upi/intent
 * Creates a UPI Autopay authorization via the intent flow for an already-created
 * subscription. Returns an intent URL the app uses to (1) open a chosen
 * installed UPI app and (2) render a scannable QR code. The user approves the
 * mandate in their UPI app; the webhook activates Premium.
 *
 * Body: { subscriptionId }. Responds 200 with an `available` flag so the app can
 * fall back when S2S is not enabled.
 */
export const initiateUpiIntent = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const subscriptionId = String(req.body?.subscriptionId ?? '').trim();
  if (!subscriptionId) throw new AppError('subscription_not_found', 400, 'subscription_not_found');

  const payment = await Payment.findOne({ userId, razorpaySubscriptionId: subscriptionId });
  if (!payment) throw new AppError('subscription_not_found', 404, 'subscription_not_found');

  const planType = payment.planType || 'monthly';
  const amount = PLAN_AMOUNT_PAISE[planType] ?? PLAN_AMOUNT_PAISE.monthly;

  const user = await User.findById(userId);
  const phone = user?.phone ?? '';
  const email = phone ? `${phone}@examwarrior.app` : 'user@examwarrior.app';

  try {
    const result: any = await createUpiIntentCharge({
      amount,
      email,
      contact: phone,
      subscriptionId,
      ip: req.ip,
      referer: (req.headers['referer'] as string) || 'https://examwarrior.in',
      userAgent: (req.headers['user-agent'] as string) || 'ExamWarriorApp',
    });

    await Payment.updateOne(
      { _id: payment._id },
      { method: 'upi', razorpayPaymentId: result?.razorpay_payment_id ?? payment.razorpayPaymentId },
    );

    return res.json({
      success: true,
      data: {
        available: true,
        status: 'pending',
        paymentId: result?.razorpay_payment_id ?? null,
        intentUrl: result?.link ?? null,
        message: getMessage('upi_mandate_pending', req.lang),
      },
    });
  } catch (err: any) {
    const info = razorpayErrorInfo(err);
    if (isS2SUnavailable(err)) {
      console.warn('[Payment] UPI intent unavailable (S2S not enabled):', info.description);
      return res.json({ success: true, data: { available: false, status: 'unavailable' } });
    }
    console.error('[Payment] UPI intent error:', info);
    throw new AppError('upi_autopay_failed', 400, 'upi_autopay_failed');
  }
});

/**
 * GET /payments/status
 * Returns current subscription status for the authenticated user.
 */
export const getPaymentStatus = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const user = await User.findById(userId);
  if (!user) throw new AppError('user_not_found', 404);

  res.json({
    success: true,
    data: {
      status: user.subscriptionStatus,
      expiryDate: user.subscriptionEndDate,
      razorpaySubId: user.razorpaySubId,
    },
  });
});

/**
 * GET /payments/history
 * Returns payment history for the authenticated user.
 */
export const getPaymentHistory = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);

  const payments = await Payment.find({ userId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('planType amount status paidAt createdAt');

  res.json({
    success: true,
    data: payments,
  });
});



/**
 * POST /payments/webhook
 * Razorpay webhook — the ONLY trusted source of payment confirmation.
 * CRITICAL: Never trust frontend success. Only trust this webhook.
 */
export const razorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const receivedSignature = req.headers['x-razorpay-signature'] as string;

    if (!webhookSecret || !receivedSignature) {
      console.error('[Webhook] Missing webhook secret or signature header');
      throw new AppError('missing_config', 400);
    }

    // req.body is a Buffer because of express.raw() in server.ts
    const rawBody = req.body;
    
    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== receivedSignature) {
      console.error('[Webhook] Signature mismatch! Rejecting.');
      await session.abortTransaction();
      throw new AppError('invalid_signature', 400);
    }

    // Step 2: Parse event
    const event = JSON.parse(rawBody.toString());
    const eventType = event.event;

    console.log(`[Webhook] Received event: ${eventType}`);

    // Push notification to fire AFTER the DB transaction commits (so we never
    // tell a user "payment done" if the write rolled back). Set in branches.
    let notifyUserId: string | null = null;
    let notifyKind: 'success' | 'ended' | null = null;

    // Step 3: Handle events
    if (eventType === 'subscription.charged' || eventType === 'payment.captured') {
      const paymentEntity = event.payload?.payment?.entity;
      const subscriptionEntity = event.payload?.subscription?.entity;

      if (!paymentEntity) {
        console.error('[Webhook] No payment entity in payload');
        await session.abortTransaction();
        return res.status(200).json({ status: 'ok' });
      }

      const razorpayPaymentId = paymentEntity.id;
      const razorpaySubscriptionId = subscriptionEntity?.id || paymentEntity.subscription_id;
      const amount = paymentEntity.amount; // in paise
      const method = paymentEntity.method;

      // Idempotency check: Have we processed this payment ID already?
      const existingPayment = await Payment.findOne({ razorpayPaymentId }).session(session);
      if (existingPayment && existingPayment.status === 'active') {
        console.log(`[Webhook] Payment ${razorpayPaymentId} already processed. Skipping.`);
        await session.commitTransaction();
        return res.status(200).json({ status: 'ok' });
      }

      // Find the user/payment record
      let paymentRecord = await Payment.findOne({ razorpaySubscriptionId }).session(session);
      
      // If no record, try finding user to create one
      if (!paymentRecord) {
        const user = await User.findOne({ razorpaySubId: razorpaySubscriptionId }).session(session);
        if (user) {
          paymentRecord = new Payment({
            userId: user._id,
            razorpaySubscriptionId,
            planId: subscriptionEntity?.plan_id || 'unknown',
            planType: 'monthly', // default if missing
          });
        }
      }

      if (paymentRecord) {
        // Update payment record
        paymentRecord.razorpayPaymentId = razorpayPaymentId;
        paymentRecord.amount = amount;
        paymentRecord.method = method;
        paymentRecord.status = 'active';
        paymentRecord.paidAt = new Date();
        await paymentRecord.save({ session });

        // Calculate subscription end date
        const planType = paymentRecord.planType || 'monthly';
        const durationMonths = planType === 'yearly' ? 12 : 1;
        const subscriptionEndDate = new Date();
        subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + durationMonths);

        // Update Subscription document
        const subDoc = await Subscription.findOneAndUpdate(
          { razorpaySubscriptionId },
          {
            userId: paymentRecord.userId,
            planId: subscriptionEntity?.plan_id || paymentRecord.planId,
            planType: planType,
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: subscriptionEndDate,
          },
          { upsert: true, new: true, session }
        );

        // Update User profile
        await User.findByIdAndUpdate(paymentRecord.userId, {
          subscriptionStatus: 'active',
          subscriptionEndDate,
          razorpaySubId: razorpaySubscriptionId,
          subscriptionId: subDoc?._id,
        }, { session });

        notifyUserId = String(paymentRecord.userId);
        notifyKind = 'success';

        console.log(`[Webhook] ✅ Successfully processed ${eventType} for User ${paymentRecord.userId}`);
      } else {
        console.error(`[Webhook] No user/payment record found for subscription: ${razorpaySubscriptionId}`);
      }
    } 
    
    // A renewal failed and Razorpay gave up retrying (halted), the user
    // cancelled, or the subscription ran its full course (completed). In every
    // case auto-renew has stopped, so the user must lose Premium — otherwise a
    // failed renewal would leave them on Premium for free.
    else if (
      eventType === 'subscription.cancelled' ||
      eventType === 'subscription.halted' ||
      eventType === 'subscription.completed'
    ) {
      const subscriptionId = event.payload?.subscription?.entity?.id;
      // 'halted' = renewal payments failed; 'cancelled'/'completed' = ended.
      // Subscription model has a 'halted' status; Payment model does not, so
      // pending payment rows are simply marked 'cancelled'.
      const subStatus = eventType === 'subscription.halted' ? 'halted' : 'cancelled';
      if (subscriptionId) {
        await Payment.updateMany(
          { razorpaySubscriptionId: subscriptionId, status: { $ne: 'active' } },
          { status: 'cancelled' },
          { session }
        );

        await Subscription.findOneAndUpdate(
          { razorpaySubscriptionId: subscriptionId },
          { status: subStatus, endedAt: new Date() },
          { session }
        );

        const downgraded = await User.findOneAndUpdate(
          { razorpaySubId: subscriptionId },
          { subscriptionStatus: 'expired' },
          { session }
        );
        if (downgraded) {
          notifyUserId = String(downgraded._id);
          notifyKind = 'ended';
        }

        console.log(`[Webhook] Subscription ${subscriptionId} -> ${eventType} (user downgraded).`);
      }
    }

    await session.commitTransaction();

    // Fire-and-forget push AFTER commit — never blocks the webhook response and
    // can't roll the transaction back if FCM hiccups.
    if (notifyUserId && notifyKind) {
      notifyPaymentEvent(notifyUserId, notifyKind).catch((e) =>
        console.error('[Webhook] payment push failed:', e.message),
      );
    }

    res.status(200).json({ status: 'ok' });

  } catch (error: any) {
    console.error('[Webhook] ERROR:', error.message);
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    // Always return 200 to Razorpay to prevent retry loops on logical errors
    res.status(200).json({ status: 'ok', error: error.message });
  } finally {
    session.endSession();
  }
});
