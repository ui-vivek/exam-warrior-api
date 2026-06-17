import { Response } from 'express';
import mongoose from 'mongoose';
import { Room } from '@/model/room.model';
import { Question } from '@/model/question.model';
import { User } from '@/model/user.model';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
const pickLang = (field: any, lang: string): string => {
  if (typeof field === 'string') return field;
  // Fall back across languages so content shows even if one is empty.
  return field?.[lang] || field?.en || field?.hi || '';
};

const genCode = (): string =>
  Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

/** Strips internal fields and never leaks correct answers. */
const serializeRoom = (room: any, userId: string) => ({
  code: room.code,
  hostName: room.hostName,
  examType: room.examType,
  status: room.status,
  totalQuestions: room.totalQuestions,
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

  res.json({ success: true, data: serializeRoom(room, userId) });
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
  if (!already) {
    const user = await User.findById(userId);
    room.participants.push({ userId, name: user?.name || 'Warrior' } as any);
    await room.save();
  }

  res.json({ success: true, data: serializeRoom(room, userId) });
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
    { $match: { examType: room.examType, isActive: true } },
    { $sample: { size: room.totalQuestions } },
  ]);
  if (questions.length === 0) throw new AppError('no_questions_found', 404);

  room.questionIds = questions.map((q: any) => q._id);
  room.totalQuestions = questions.length;
  room.status = 'active';
  room.startedAt = new Date();
  await room.save();

  res.json({ success: true, data: serializeRoom(room, userId) });
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
    optionA: q.options?.a ? pickLang(q.options.a, lang) : q.optionA,
    optionB: q.options?.b ? pickLang(q.options.b, lang) : q.optionB,
    optionC: q.options?.c ? pickLang(q.options.c, lang) : q.optionC,
    optionD: q.options?.d ? pickLang(q.options.d, lang) : q.optionD,
    subject: q.subject,
    topic: q.topic,
  }));

  res.json({ success: true, data: { totalQuestions: room.totalQuestions, questions: data } });
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

  let score = 0;
  for (const a of answers) {
    const correct = correctMap[String(a.questionId)];
    if (correct && String(a.selectedOption || '').toLowerCase() === correct) score++;
  }

  participant.score = score;
  participant.finishedAt = new Date();

  const allFinished = room.participants.every((p: any) => p.score !== null && p.score !== undefined);
  if (allFinished) room.status = 'finished';
  await room.save();

  res.json({ success: true, data: { score, total: room.totalQuestions } });
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
