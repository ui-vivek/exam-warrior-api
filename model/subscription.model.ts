import mongoose from 'mongoose';

const SubscriptionSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  razorpaySubscriptionId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  planId: { 
    type: String, 
    required: true 
  },
  planType: { 
    type: String, 
    enum: ['monthly', 'yearly'], 
    required: true 
  },
  status: { 
    type: String, 
    required: true,
    enum: ['created', 'authenticated', 'active', 'pending', 'expired', 'cancelled', 'halted'],
    default: 'created'
  },
  currentPeriodStart: { 
    type: Date 
  },
  currentPeriodEnd: { 
    type: Date 
  },
  cancelAtPeriodEnd: { 
    type: Boolean, 
    default: false 
  },
  endedAt: { 
    type: Date 
  },
}, { timestamps: true });

SubscriptionSchema.index({ userId: 1, status: 1 });
SubscriptionSchema.index({ razorpaySubscriptionId: 1 });

export const Subscription = mongoose.model('Subscription', SubscriptionSchema);
