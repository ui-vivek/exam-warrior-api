import { Response, NextFunction } from 'express';
import { User } from '@/model/user.model';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';

export const subscriptionMiddleware = async (req: LangRequest, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) throw new AppError('user_not_found', 404);

    // 1. Check if subscription is active
    if (user.subscriptionStatus === 'active') {
      if (user.subscriptionEndDate && user.subscriptionEndDate < new Date()) {
        // Subscription expired — update MongoDB
        await User.findByIdAndUpdate(req.userId, { subscriptionStatus: 'expired' });
        throw new AppError('SUBSCRIPTION_EXPIRED', 403);
      }
      return next();
    }

    // 2. Check Trial Status
    if (user.subscriptionStatus === 'trial') {
      const trialEnd = new Date(user.trialStartDate);
      trialEnd.setDate(trialEnd.getDate() + 7);
      
      if (new Date() > trialEnd) {
        await User.findByIdAndUpdate(req.userId, { subscriptionStatus: 'expired' });
        throw new AppError('TRIAL_EXPIRED', 403);
      }
      return next();
    }

    // 3. If expired or no status
    throw new AppError('SUBSCRIPTION_REQUIRED', 403);
  } catch (error) {
    next(error);
  }
};
