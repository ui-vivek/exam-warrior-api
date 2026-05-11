import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema({
  userId:                 { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  razorpayPaymentId:      { type: String },
  razorpaySubscriptionId: { type: String, required: true },
  razorpaySignature:      { type: String },
  planId:                 { type: String, required: true },
  planType:               { type: String, enum: ['monthly', 'yearly'], required: true },
  amount:                 { type: Number },  // in paise (9900 = ₹99)
  currency:               { type: String, default: 'INR' },
  method:                 { type: String }, // upi, card, netbanking, wallet etc.
  status:                 { type: String, enum: ['created', 'authenticated', 'active', 'completed', 'expired', 'cancelled', 'failed', 'refunded'], default: 'created' },
  paidAt:                 { type: Date },
}, { timestamps: true });

PaymentSchema.index({ userId: 1, status: 1 });
PaymentSchema.index({ razorpaySubscriptionId: 1 });
PaymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });

export const Payment = mongoose.model('Payment', PaymentSchema);
