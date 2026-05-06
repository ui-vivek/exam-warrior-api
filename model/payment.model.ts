import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema({
  userId:                 { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  razorpayPaymentId:      { type: String },
  razorpaySubscriptionId: { type: String },
  amount:                 { type: Number },  // in paise (9900 = ₹99)
  status:                 { type: String, enum: ['success','failed','refunded'] },
  paidAt:                 { type: Date, default: Date.now },
});

export const Payment = mongoose.model('Payment', PaymentSchema);
