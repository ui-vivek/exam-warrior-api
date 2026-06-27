import { Response } from 'express';
import mongoose from 'mongoose';
import { Institute } from '@/model/institute.model';
import { Batch } from '@/model/batch.model';
import { Membership } from '@/model/membership.model';
import { User } from '@/model/user.model';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';
import {
  assertInstituteAdmin,
  countActiveSeats,
  wouldExceedSeats,
  genUniqueBatchCode,
  serializeInstitute,
  serializeBatch,
} from '@/services/instituteService';

const oid = (v: any) => mongoose.isValidObjectId(v);

// ───────────────────────────── Admin: institutes ─────────────────────────────

/** POST /institutes — create an institute; the creator becomes its owner. */
export const createInstitute = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const { name, type } = req.body as { name: string; type?: string };
  const inst: any = await Institute.create({
    ownerId: userId,
    name,
    type: type || 'COACHING',
    staff: [{ userId, role: 'OWNER' }],
  } as any);

  res.status(201).json({ success: true, data: { institute: serializeInstitute(inst) } });
});

/** GET /institutes/mine — institutes the caller owns or is staff on. */
export const getMyInstitutes = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const list: any[] = await Institute.find({
    $or: [{ ownerId: userId }, { 'staff.userId': userId }],
  }).sort({ createdAt: -1 });

  const institutes = await Promise.all(
    list.map(async (inst) => ({
      ...serializeInstitute(inst),
      seatsUsed: await countActiveSeats(inst._id.toString()),
    })),
  );

  res.json({ success: true, data: { institutes } });
});

/** GET /institutes/:id — overview: institute, batches, headline stats. */
export const getInstitute = asyncHandler(async (req: LangRequest, res: Response) => {
  const inst = await assertInstituteAdmin(req.params.id, req.userId);

  const batches: any[] = await Batch.find({ instituteId: inst._id }).sort({ createdAt: 1 });
  const [activeStudents, pendingRequests] = await Promise.all([
    countActiveSeats(inst._id.toString()),
    Membership.countDocuments({ instituteId: inst._id, status: 'PENDING' }),
  ]);

  res.json({
    success: true,
    data: {
      institute: serializeInstitute(inst),
      batches: batches.map(serializeBatch),
      stats: { activeStudents, pendingRequests, seatsTotal: inst.seatsTotal },
    },
  });
});

/** PATCH /institutes/:id — update name / branding. */
export const updateInstitute = asyncHandler(async (req: LangRequest, res: Response) => {
  const inst = await assertInstituteAdmin(req.params.id, req.userId);

  const allowed = ['name', 'logoUrl', 'bannerUrl', 'brandColor'] as const;
  for (const key of allowed) {
    if (req.body[key] !== undefined) inst[key] = req.body[key];
  }
  await inst.save();

  res.json({ success: true, data: { institute: serializeInstitute(inst) } });
});

// ───────────────────────────── Admin: batches ────────────────────────────────

/** POST /institutes/:id/batches — create a batch (one exam type, join code). */
export const createBatch = asyncHandler(async (req: LangRequest, res: Response) => {
  const inst = await assertInstituteAdmin(req.params.id, req.userId);

  const { name, examType, requiresApproval } = req.body as {
    name: string; examType: string; requiresApproval?: boolean;
  };

  const joinCode = await genUniqueBatchCode();
  const batch: any = await Batch.create({
    instituteId: inst._id,
    name,
    examType,
    joinCode,
    requiresApproval: requiresApproval !== undefined ? requiresApproval : true,
  } as any);

  res.status(201).json({ success: true, data: { batch: serializeBatch(batch) } });
});

/** GET /institutes/:id/batches — batches with their active-student counts. */
export const listBatches = asyncHandler(async (req: LangRequest, res: Response) => {
  const inst = await assertInstituteAdmin(req.params.id, req.userId);

  const batches: any[] = await Batch.find({ instituteId: inst._id }).sort({ createdAt: 1 });
  const withCounts = await Promise.all(
    batches.map(async (b) => ({
      ...serializeBatch(b),
      activeStudents: await Membership.countDocuments({ batchId: b._id, status: 'ACTIVE' }),
    })),
  );

  res.json({ success: true, data: { batches: withCounts } });
});

// ───────────────────────────── Admin: members ────────────────────────────────

/** GET /institutes/:id/members — roster (optionally ?status=&batchId=). */
export const getMembers = asyncHandler(async (req: LangRequest, res: Response) => {
  const inst = await assertInstituteAdmin(req.params.id, req.userId);

  const q: any = { instituteId: inst._id, status: { $ne: 'REMOVED' } };
  if (req.query.status) q.status = req.query.status;
  if (req.query.batchId && oid(req.query.batchId)) q.batchId = req.query.batchId;

  const rows: any[] = await Membership.find(q)
    .populate('userId', 'name phone avatar')
    .populate('batchId', 'name examType')
    .sort({ status: 1, joinedAt: -1 });

  const members = rows.map((m) => ({
    membershipId: m._id,
    status: m.status,
    source: m.source,
    joinedAt: m.joinedAt,
    batch: m.batchId ? { id: m.batchId._id, name: m.batchId.name, examType: m.batchId.examType } : null,
    // The owner needs the phone to follow up on absent students — full number is
    // shown to admins only, never on student-facing leaderboards.
    user: m.userId
      ? { id: m.userId._id, name: m.userId.name || 'Student', phone: m.userId.phone, avatar: m.userId.avatar }
      : null,
  }));

  res.json({ success: true, data: { members } });
});

/** POST /institutes/:id/members/:membershipId/approve — approve a pending join. */
export const approveMember = asyncHandler(async (req: LangRequest, res: Response) => {
  const inst = await assertInstituteAdmin(req.params.id, req.userId);
  const { membershipId } = req.params;
  if (!oid(membershipId)) throw new AppError('membership_not_found', 404);

  const m: any = await Membership.findOne({ _id: membershipId, instituteId: inst._id });
  if (!m) throw new AppError('membership_not_found', 404);
  if (m.status === 'ACTIVE') {
    return res.json({ success: true, data: { membershipId: m._id, status: m.status } });
  }

  if (await wouldExceedSeats(inst, m.userId.toString())) {
    throw new AppError('seats_full', 403, 'SEATS_FULL');
  }

  m.status = 'ACTIVE';
  m.approvedAt = new Date();
  await m.save();

  res.json({ success: true, data: { membershipId: m._id, status: m.status } });
});

/** DELETE /institutes/:id/members/:membershipId — remove a student (frees seat). */
export const removeMember = asyncHandler(async (req: LangRequest, res: Response) => {
  const inst = await assertInstituteAdmin(req.params.id, req.userId);
  const { membershipId } = req.params;
  if (!oid(membershipId)) throw new AppError('membership_not_found', 404);

  const m: any = await Membership.findOne({ _id: membershipId, instituteId: inst._id });
  if (!m) throw new AppError('membership_not_found', 404);

  m.status = 'REMOVED';
  m.removedAt = new Date();
  await m.save();

  res.json({ success: true, data: { membershipId: m._id, status: m.status } });
});

/** POST /institutes/:id/members — manually add an existing user by phone. */
export const manualAddMember = asyncHandler(async (req: LangRequest, res: Response) => {
  const inst = await assertInstituteAdmin(req.params.id, req.userId);
  const { phone, batchId } = req.body as { phone: string; batchId: string };

  if (!oid(batchId)) throw new AppError('batch_not_found', 404);
  const batch: any = await Batch.findOne({ _id: batchId, instituteId: inst._id });
  if (!batch) throw new AppError('batch_not_found', 404);

  // Light phone normalization: accept "9999999999" or "+919999999999".
  const digits = phone.replace(/\D/g, '');
  const candidates = [phone, `+${digits}`, `+91${digits.slice(-10)}`];
  const user: any = await User.findOne({ phone: { $in: candidates } });
  if (!user) throw new AppError('user_not_found_invite_to_install', 404, 'USER_NOT_FOUND');

  if (await wouldExceedSeats(inst, user._id.toString())) {
    throw new AppError('seats_full', 403, 'SEATS_FULL');
  }

  const m: any = await Membership.findOneAndUpdate(
    { userId: user._id, batchId: batch._id },
    {
      $set: { status: 'ACTIVE', source: 'MANUAL', approvedAt: new Date() },
      $setOnInsert: { instituteId: inst._id, joinedAt: new Date() },
    },
    { new: true, upsert: true },
  );

  res.status(201).json({ success: true, data: { membershipId: m._id, status: m.status } });
});

// ───────────────────────────── Student side ──────────────────────────────────

/** POST /institutes/join — student joins a batch by its code. */
export const joinBatch = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const { code } = req.body as { code: string };
  const batch: any = await Batch.findOne({ joinCode: code });
  if (!batch) throw new AppError('invalid_code', 404, 'INVALID_CODE');
  if (!batch.joinOpen) throw new AppError('joins_closed', 403, 'JOINS_CLOSED');

  const inst: any = await Institute.findById(batch.instituteId);
  if (!inst) throw new AppError('institute_not_found', 404);

  const existing: any = await Membership.findOne({ userId, batchId: batch._id });
  if (existing && existing.status === 'ACTIVE') {
    return res.json({
      success: true,
      message: 'already_member',
      data: { status: 'ACTIVE', institute: serializeInstitute(inst), batch: serializeBatch(batch) },
    });
  }

  // Auto-approve only when the batch allows it AND a seat is free; otherwise the
  // student lands as PENDING for the admin to approve.
  let status: 'PENDING' | 'ACTIVE' = 'PENDING';
  if (!batch.requiresApproval && !(await wouldExceedSeats(inst, userId))) {
    status = 'ACTIVE';
  }

  const update: any = {
    $set: { status, source: 'CODE' },
    $setOnInsert: { instituteId: inst._id, joinedAt: new Date() },
  };
  if (status === 'ACTIVE') update.$set.approvedAt = new Date();

  await Membership.findOneAndUpdate({ userId, batchId: batch._id }, update, { upsert: true });

  res.json({
    success: true,
    message: status === 'ACTIVE' ? 'joined' : 'pending_approval',
    data: {
      status,
      institute: { id: inst._id, name: inst.name, type: inst.type },
      batch: { id: batch._id, name: batch.name, examType: batch.examType },
    },
  });
});

/** GET /institutes/joined — institutes the student has joined (grouped). */
export const getJoinedInstitutes = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const rows: any[] = await Membership.find({ userId, status: { $in: ['ACTIVE', 'PENDING'] } })
    .populate('instituteId', 'name type logoUrl brandColor')
    .populate('batchId', 'name examType')
    .sort({ joinedAt: -1 });

  const byInstitute = new Map<string, any>();
  for (const m of rows) {
    if (!m.instituteId) continue;
    const key = m.instituteId._id.toString();
    if (!byInstitute.has(key)) {
      byInstitute.set(key, {
        institute: {
          id: m.instituteId._id,
          name: m.instituteId.name,
          type: m.instituteId.type,
          logoUrl: m.instituteId.logoUrl || null,
          brandColor: m.instituteId.brandColor || null,
        },
        myStatus: 'PENDING',
        batches: [],
      });
    }
    const entry = byInstitute.get(key);
    if (m.batchId) {
      entry.batches.push({
        id: m.batchId._id,
        name: m.batchId.name,
        examType: m.batchId.examType,
        status: m.status,
      });
    }
    if (m.status === 'ACTIVE') entry.myStatus = 'ACTIVE';
  }

  res.json({ success: true, data: { institutes: Array.from(byInstitute.values()) } });
});
