import { User } from '@/model/user.model';

export async function getUsers() {
  return await User.find();
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

export async function updateUserProfile(userId: string, data: { name?: string, examType?: string, preferredLanguage?: string, state?: string }) {
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
