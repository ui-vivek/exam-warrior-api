import { User } from '@/model/user.model';

export async function getUsers() {
  return await User.find();
}
