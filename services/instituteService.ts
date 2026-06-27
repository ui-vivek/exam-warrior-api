import mongoose from 'mongoose';
import { Institute } from '@/model/institute.model';
import { Batch } from '@/model/batch.model';
import { Membership } from '@/model/membership.model';
import { AppError } from '@/utils/AppError';

// Join codes mirror the Room model: uppercase, no ambiguous characters (no
// O/0/I/1) so students can read them off a whiteboard without confusion.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const gen = (): string =>
  Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

/** A batch join code that is not already taken (a few retries on collision). */
export const genUniqueBatchCode = async (): Promise<string> => {
  let code = gen();
  for (let i = 0; i < 6 && (await Batch.exists({ joinCode: code })); i++) code = gen();
  return code;
};

/**
 * Loads the institute and asserts the caller may administer it (owner or staff).
 * Throws 404 if missing, 403 if the user is not an admin. Returns the doc.
 */
export const assertInstituteAdmin = async (instituteId: any, userId?: string) => {
  if (!userId) throw new AppError('unauthorized', 401);
  if (!mongoose.isValidObjectId(instituteId)) throw new AppError('institute_not_found', 404);

  const inst: any = await Institute.findById(instituteId);
  if (!inst) throw new AppError('institute_not_found', 404);

  const isOwner = inst.ownerId.toString() === userId;
  const isStaff = (inst.staff || []).some((s: any) => s.userId.toString() === userId);
  if (!isOwner && !isStaff) throw new AppError('forbidden', 403);

  return inst;
};

/**
 * Seats are counted as UNIQUE active students across the whole institute, not
 * per membership — a student in two of the institute's batches uses one seat.
 */
export const countActiveSeats = async (instituteId: string): Promise<number> => {
  const ids = await Membership.distinct('userId', { instituteId, status: 'ACTIVE' });
  return ids.length;
};

/**
 * True if adding `userId` as active would exceed the institute's seat cap.
 * A user who is already active somewhere in the institute is free (no new seat).
 */
export const wouldExceedSeats = async (inst: any, userId: string): Promise<boolean> => {
  const alreadyActive = await Membership.exists({
    instituteId: inst._id,
    userId,
    status: 'ACTIVE',
  });
  if (alreadyActive) return false;
  const used = await countActiveSeats(inst._id.toString());
  return used >= (inst.seatsTotal || 0);
};

export const serializeInstitute = (inst: any) => ({
  id: inst._id,
  name: inst.name,
  type: inst.type,
  logoUrl: inst.logoUrl || null,
  bannerUrl: inst.bannerUrl || null,
  brandColor: inst.brandColor || null,
  plan: inst.plan,
  seatsTotal: inst.seatsTotal,
  status: inst.status,
});

export const serializeBatch = (b: any) => ({
  id: b._id,
  name: b.name,
  examType: b.examType,
  joinCode: b.joinCode,
  joinOpen: b.joinOpen,
  requiresApproval: b.requiresApproval,
});
