import { Response } from 'express';
import mongoose from 'mongoose';
import { Room } from '@/model/room.model';
import { Question } from '@/model/question.model';
import { User } from '@/model/user.model';
import { Bookmark } from '@/model/bookmark.model';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';
import { notifyClassroomResult } from '@/services/notificationService';
import { awardBadges } from '@/services/badgeService';
import { getTodayIST } from '@/utils/dateHelper';

// Daily room-creation (host) limits. Trial counts as paid so new users get the
// full hosting experience; only an expired subscription drops to the free tier.
const ROOM_LIMIT_FREE = Number(process.env.ROOM_LIMIT_FREE) || 2;
const ROOM_LIMIT_PAID = Number(process.env.ROOM_LIMIT_PAID) || 20;
const isPaidStatus = (status?: string) => status === 'active' || status === 'trial';
const roomLimitFor = (status?: string) =>
  isPaidStatus(status) ? ROOM_LIMIT_PAID : ROOM_LIMIT_FREE;
// Rooms the user has created today (0 once the stored day rolls over).
const roomsUsedToday = (user: any, todayKey: string): number => {
  const t = user?.roomCreateTrack;
  return t && t.dateKey === todayKey ? (t.count || 0) : 0;
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
// Reads the requested language from the nested bilingual question model.
// en/hi cross-fallback only covers a rare empty side within the same model.
const pickLang = (field: any, lang: string): string =>
  field?.[lang] || field?.en || field?.hi || '';

const genCode = (): string =>
  Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

// Each question gets this much time; the whole room shares one countdown.
// Override with ROOM_SECONDS_PER_QUESTION (e.g. 6) to test the timer quickly.
const SECONDS_PER_QUESTION = Number(process.env.ROOM_SECONDS_PER_QUESTION) || 60;

/** Seconds left on the room's shared timer (0 once over, null before it starts). */
const remainingSecOf = (room: any): number | null => {
  if (!room.endsAt) return null;
  return Math.max(0, Math.floor((new Date(room.endsAt).getTime() - Date.now()) / 1000));
};

/** Strips internal fields and never leaks correct answers. */
const serializeRoom = (room: any, userId: string) => ({
  code: room.code,
  hostName: room.hostName,
  examType: room.examType,
  status: room.status,
  totalQuestions: room.totalQuestions,
  durationSec: room.durationSec,
  endsAt: room.endsAt,
  remainingSec: remainingSecOf(room),
  isHost: room.hostId.toString() === userId,
  participants: (room.participants || []).map((p: any) => ({
    name: p.name,
    score: p.score,
    finished: p.score !== null && p.score !== undefined,
    isMe: p.userId.toString() === userId,
  })),
});

/** POST /rooms — host creates a classroom. */
export const createRoom = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const user = await User.findById(userId);
  if (!user) throw new AppError('user_not_found', 404);

  // Daily host quota: free 2, paid (active/trial) 20. Counted via a per-user
  // counter so the 6h room TTL can't be used to bypass the limit.
  const todayKey = getTodayIST();
  const limit = roomLimitFor(user.subscriptionStatus);
  const used = roomsUsedToday(user, todayKey);
  if (used >= limit) {
    // The app maps this code to an upgrade prompt.
    throw new AppError('room_limit_reached', 403);
  }

  let code = genCode();
  for (let i = 0; i < 5 && (await Room.exists({ code })); i++) code = genCode();

  const hostName = user.name || 'Host';
  const room = await Room.create({
    code,
    hostId: userId,
    hostName,
    examType: user.examType || 'SSC',
    status: 'lobby',
    participants: [{ userId, name: hostName }],
  });

  // Record the creation against today's quota.
  (user as any).roomCreateTrack = { dateKey: todayKey, count: used + 1 };
  user.markModified('roomCreateTrack');
  await user.save();

  res.json({ success: true, data: serializeRoom(room, userId) });
});

/**
 * GET /rooms/quota — today's room-creation allowance for the current user, so
 * the classroom screen can show "used / left" and gate free users.
 */
export const getRoomQuota = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const user: any = await User.findById(userId)
    .select('subscriptionStatus roomCreateTrack')
    .lean();
  if (!user) throw new AppError('user_not_found', 404);

  const todayKey = getTodayIST();
  const limit = roomLimitFor(user.subscriptionStatus);
  const used = roomsUsedToday(user, todayKey);

  res.json({
    success: true,
    data: {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      isPaid: isPaidStatus(user.subscriptionStatus),
    },
  });
});

/** POST /rooms/:code/join — join an existing lobby. */
export const joinRoom = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const code = String(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code });
  if (!room) throw new AppError('room_not_found', 404);
  if (room.status !== 'lobby') throw new AppError('room_already_started', 400);

  const already = room.participants.some((p: any) => p.userId.toString() === userId);
  let current: any = room;
  if (!already) {
    const user = await User.findById(userId);
    // Atomic add: only push while still in the lobby and not already present.
    // Prevents two simultaneous joins from clobbering each other's write or
    // adding the same participant twice.
    const updated = await Room.findOneAndUpdate(
      { code, status: 'lobby', 'participants.userId': { $ne: new mongoose.Types.ObjectId(userId) } },
      { $push: { participants: { userId, name: user?.name || 'Warrior' } } },
      { new: true }
    );
    current = updated || (await Room.findOne({ code })) || room;
  }

  res.json({ success: true, data: serializeRoom(current, userId) });
});

/** GET /rooms/:code — current room state (polled by clients). */
export const getRoom = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const code = String(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code });
  if (!room) throw new AppError('room_not_found', 404);

  res.json({ success: true, data: serializeRoom(room, userId) });
});

/** POST /rooms/:code/start — host starts the group test. */
export const startRoom = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const code = String(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code });
  if (!room) throw new AppError('room_not_found', 404);
  if (room.hostId.toString() !== userId) throw new AppError('only_host_can_start', 403);
  if (room.status !== 'lobby') throw new AppError('room_already_started', 400);

  const questions = await Question.aggregate([
    { $match: { examTypes: room.examType, isActive: true } },
    { $sample: { size: room.totalQuestions } },
  ]);
  if (questions.length === 0) throw new AppError('no_questions_found', 404);

  // Shared countdown: starts now, lasts totalQuestions * SECONDS_PER_QUESTION.
  const startedAt = new Date();
  const durationSec = questions.length * SECONDS_PER_QUESTION;
  const endsAt = new Date(startedAt.getTime() + durationSec * 1000);

  // Atomic start: only the transition out of 'lobby' by the host succeeds, so a
  // double-tap / concurrent start can't reshuffle questions or re-start.
  const updated = await Room.findOneAndUpdate(
    { code, status: 'lobby', hostId: new mongoose.Types.ObjectId(userId) },
    {
      $set: {
        questionIds: questions.map((q: any) => q._id),
        totalQuestions: questions.length,
        status: 'active',
        startedAt,
        durationSec,
        endsAt,
      },
    },
    { new: true }
  );
  if (!updated) throw new AppError('room_already_started', 400);

  res.json({ success: true, data: serializeRoom(updated, userId) });
});

/** GET /rooms/:code/test — the shared questions (no answers). */
export const getRoomTest = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const code = String(req.params.code || '').toUpperCase();
  const lang = req.lang || 'en';
  const room = await Room.findOne({ code });
  if (!room) throw new AppError('room_not_found', 404);
  if (room.status === 'lobby') throw new AppError('room_not_started', 400);

  const questions = await Question.find({ _id: { $in: room.questionIds } })
    .select('-correctOption -explanation')
    .lean();

  const data = questions.map((q: any) => ({
    _id: q._id,
    questionText: pickLang(q.questionText, lang),
    optionA: pickLang(q.options?.a, lang),
    optionB: pickLang(q.options?.b, lang),
    optionC: pickLang(q.options?.c, lang),
    optionD: pickLang(q.options?.d, lang),
    subject: q.subject,
    topic: q.topic,
  }));

  res.json({
    success: true,
    data: {
      totalQuestions: room.totalQuestions,
      questions: data,
      durationSec: room.durationSec,
      endsAt: room.endsAt,
      remainingSec: remainingSecOf(room),
    },
  });
});

/** POST /rooms/:code/submit — score the participant's answers server-side. */
export const submitRoomScore = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const code = String(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code });
  if (!room) throw new AppError('room_not_found', 404);
  if (room.status === 'lobby') throw new AppError('room_not_started', 400);

  const participant = room.participants.find((p: any) => p.userId.toString() === userId);
  if (!participant) throw new AppError('not_in_room', 403);
  if (participant.score !== null && participant.score !== undefined) {
    return res.json({ success: true, data: { score: participant.score, total: room.totalQuestions } });
  }

  const { answers = [] } = req.body as { answers: { questionId: string; selectedOption: string }[] };
  const questions = await Question.find({ _id: { $in: room.questionIds } }).select('correctOption').lean();
  const correctMap: Record<string, string> = {};
  questions.forEach((q: any) => { correctMap[q._id.toString()] = String(q.correctOption || '').toLowerCase(); });

  // Score + record each answer (so the user can review their attempt later).
  let score = 0;
  const attemptAnswers: any[] = [];
  for (const a of answers) {
    if (!a || !a.questionId) continue;
    const correct = correctMap[String(a.questionId)];
    const sel = String(a.selectedOption || '').toLowerCase();
    const isCorrect = !!correct && sel === correct;
    if (isCorrect) score++;
    attemptAnswers.push({
      questionId: a.questionId,
      selectedOption: sel || undefined,
      isCorrect,
    });
  }

  // Atomically record the score only while this participant's score is still
  // null, so concurrent submits can't double-write or race each other.
  const myId = new mongoose.Types.ObjectId(userId);
  const updated = await Room.findOneAndUpdate(
    { code, participants: { $elemMatch: { userId: myId, score: null } } },
    {
      $set: {
        'participants.$[p].score': score,
        'participants.$[p].answers': attemptAnswers,
        'participants.$[p].finishedAt': new Date(),
      },
    },
    { arrayFilters: [{ 'p.userId': myId, 'p.score': null }], new: true }
  );

  if (!updated) {
    // A concurrent submit already scored this participant — return that score.
    const fresh = await Room.findOne({ code });
    const mine = fresh?.participants.find((p: any) => p.userId.toString() === userId);
    return res.json({ success: true, data: { score: mine?.score ?? score, total: room.totalQuestions } });
  }

  // Flip to 'finished' once everyone has a score (idempotent, guarded update).
  const allFinished = updated.participants.every((p: any) => p.score !== null && p.score !== undefined);
  if (allFinished && updated.status !== 'finished') {
    const flip = await Room.updateOne(
      { code, status: { $ne: 'finished' } },
      { $set: { status: 'finished' } },
    );
    // Only the request that actually performed the flip sends the push, so the
    // "results ready" notification fires exactly once per room. Notify everyone
    // except the person who just submitted (they're already on the result).
    if (flip.modifiedCount === 1) {
      const recipients = updated.participants
        .map((p: any) => p.userId.toString())
        .filter((id: string) => id !== userId);
      notifyClassroomResult(code, recipients).catch((e) =>
        console.error('[Room] result push failed:', e.message),
      );
      // Battle Winner badge for the top scorer (only a real win, score > 0).
      const winner = rankParticipants(updated.participants)[0];
      if (winner && (winner.score || 0) > 0) {
        awardBadges(winner.userId.toString(), ['battle_winner']).catch(() => {});
      }
    }
  }

  res.json({ success: true, data: { score, total: updated.totalQuestions } });
});

/** GET /rooms/:code/leaderboard — participants ranked by score. */
export const getLeaderboard = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const code = String(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code });
  if (!room) throw new AppError('room_not_found', 404);

  const ranked = rankParticipants(room.participants).map((p: any) => ({
    name: p.name,
    score: p.score ?? 0,
    finished: p.score !== null && p.score !== undefined,
    isMe: p.userId.toString() === userId,
  }));

  res.json({
    success: true,
    data: { status: room.status, totalQuestions: room.totalQuestions, leaderboard: ranked },
  });
});

/**
 * Orders participants for a leaderboard: finished players first (ranked by
 * highest score, then fastest finish time as a tie-break), with everyone still
 * solving placed at the bottom. Returns a new array; does not mutate input.
 */
const rankParticipants = (participants: any[] = []): any[] =>
  [...participants].sort((a: any, b: any) => {
    const aDone = a.score !== null && a.score !== undefined;
    const bDone = b.score !== null && b.score !== undefined;
    if (aDone !== bDone) return aDone ? -1 : 1; // finished above unfinished
    if (!aDone) return 0; // both still solving
    if (b.score !== a.score) return b.score - a.score; // higher score first
    const at = a.finishedAt ? new Date(a.finishedAt).getTime() : Infinity;
    const bt = b.finishedAt ? new Date(b.finishedAt).getTime() : Infinity;
    return at - bt; // faster finish wins the tie
  });

/**
 * GET /rooms — the classrooms the current user has joined (history).
 * Returns each room with the user's own score & rank, kept entirely separate
 * from daily tests so it never affects the all-India / state ranking.
 */
export const getMyRooms = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const rooms = await Room.find({ 'participants.userId': userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const data = rooms.map((room: any) => {
    const participants = room.participants || [];
    const ordered = rankParticipants(participants);
    const myIndex = ordered.findIndex(
      (p: any) => p.userId.toString() === userId,
    );
    const me = myIndex >= 0 ? ordered[myIndex] : null;
    const iFinished = me && me.score !== null && me.score !== undefined;
    const finishedCount = participants.filter(
      (p: any) => p.score !== null && p.score !== undefined,
    ).length;

    return {
      code: room.code,
      examType: room.examType,
      status: room.status,
      totalQuestions: room.totalQuestions,
      participantCount: participants.length,
      finishedCount,
      isHost: room.hostId.toString() === userId,
      myScore: iFinished ? me.score : null,
      myRank: iFinished ? myIndex + 1 : null,
      date: room.startedAt || room.createdAt,
    };
  });

  res.json({ success: true, data });
});

/**
 * GET /rooms/:code/review — the signed-in user's own attempt for this room:
 * each question with the correct answer, their selected option, and the
 * explanation. Same shape as the daily-test review so the app reuses that UI.
 * Only available once the user has finished (submitted) the room test.
 */
export const getRoomReview = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const code = String(req.params.code || '').toUpperCase();
  const lang = req.lang || 'en';
  const room = await Room.findOne({ code });
  if (!room) throw new AppError('room_not_found', 404);

  const participant: any = room.participants.find(
    (p: any) => p.userId.toString() === userId,
  );
  if (!participant) throw new AppError('not_in_room', 403);
  if (participant.score === null || participant.score === undefined) {
    throw new AppError('room_not_finished', 409);
  }

  const questions = await Question.find({ _id: { $in: room.questionIds } }).lean();
  const qById = new Map(questions.map((q: any) => [q._id.toString(), q]));

  // The participant's answers, keyed by question.
  const answerMap: Record<string, any> = {};
  (participant.answers || []).forEach((a: any) => {
    if (a.questionId) answerMap[a.questionId.toString()] = a;
  });

  // Which of these questions has the user already bookmarked?
  const bookmarks = await Bookmark.find({ userId, questionId: { $in: room.questionIds } })
    .select('questionId')
    .lean();
  const bookmarkedSet = new Set(bookmarks.map((b: any) => b.questionId.toString()));

  // Preserve the order the questions were shown in.
  const data = (room.questionIds || [])
    .map((qid: any) => {
      const q = qById.get(qid.toString());
      if (!q) return null;
      const mine = answerMap[q._id.toString()];
      return {
        questionId: q._id,
        questionText: pickLang(q.questionText, lang),
        optionA: pickLang(q.options?.a, lang),
        optionB: pickLang(q.options?.b, lang),
        optionC: pickLang(q.options?.c, lang),
        optionD: pickLang(q.options?.d, lang),
        correctOption: q.correctOption,
        // Key kept as `explanationHindi` to match the daily-review payload.
        explanationHindi: pickLang(q.explanation, lang),
        subject: q.subject,
        topic: q.topic,
        selectedOption: mine?.selectedOption ?? null,
        isCorrect: mine?.isCorrect ?? false,
        isBookmarked: bookmarkedSet.has(q._id.toString()),
      };
    })
    .filter(Boolean);

  res.json({ success: true, data });
});
