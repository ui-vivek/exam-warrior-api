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
