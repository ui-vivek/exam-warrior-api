import { Request, Response, NextFunction } from 'express';
import { User } from '@/model/user.model';

export const subscriptionMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const today = new Date();
    
    if (user.subscriptionStatus === 'active') {
        if (user.subscriptionEndDate && user.subscriptionEndDate < today) {
            user.subscriptionStatus = 'expired';
            await user.save();
            return res.status(403).json({ 
                error: true, 
                message: 'Aapka subscription khatam ho gaya hai. Please renew karein.',
                code: 'SUBSCRIPTION_EXPIRED'
            });
        }
        return next();
    }

    if (user.subscriptionStatus === 'trial') {
        // Trial logic: maybe first 7 days are free
        const trialExpiry = new Date(user.trialStartDate);
        trialExpiry.setDate(trialExpiry.getDate() + 7);
        
        if (today > trialExpiry) {
            return res.status(403).json({ 
                error: true, 
                message: 'Aapka free trial khatam ho gaya hai. Please subscription lein.',
                code: 'TRIAL_EXPIRED'
            });
        }
        return next();
    }

    res.status(403).json({ 
        error: true, 
        message: 'Aapke paas active subscription nahi hai.',
        code: 'NO_SUBSCRIPTION'
    });
  } catch (error) {
    res.status(500).json({ message: 'Subscription check failed' });
  }
};
