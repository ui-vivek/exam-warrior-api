import { User } from '@/model/user.model';

/**
 * Lists users for the internal admin endpoint. Paginated and projected: never
 * returns auth/payment secrets (refreshToken, Razorpay ids), and caps the page
 * size so a growing users collection can't be dumped in a single response.
 */
export async function getUsers({ limit = 50, skip = 0 }: { limit?: number; skip?: number } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safeSkip = Math.max(skip, 0);

  return await User.find()
    .select('-refreshToken -razorpaySubId -razorpayCustomerId -subscriptionId -rankTrack')
    .sort({ createdAt: -1 })
    .skip(safeSkip)
    .limit(safeLimit)
    .lean();
}

export async function updateUserExamType(userId: string, examType: string) {
  const user = await User.findByIdAndUpdate(
    userId,
    { examType },
    { new: true }
  );
  
  if (!user) {
    throw new Error('User not found');
  }

  return user;
}

export async function updateUserLanguage(userId: string, preferredLanguage: string) {
  const user = await User.findByIdAndUpdate(
    userId,
    { preferredLanguage },
    { new: true }
  );
  
  if (!user) {
    throw new Error('User not found');
  }

  return user;
}

export async function updateUserProfile(userId: string, data: { name?: string, examType?: string, preferredLanguage?: string, state?: string, avatar?: string }) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: data },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }

  return user;
}
