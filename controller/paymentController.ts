import { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest } from '@/middleware/authMiddleware';
import { User } from '@/model/user.model';
import { Payment } from '@/model/payment.model';
import { getRazorpay } from '@/utils/razorpay';
import { asyncHandler } from '@/utils/asyncHandler';

/**
 * POST /payments/create-subscription
 * Creates a Razorpay subscription for the authenticated user.
 */
export const createSubscription = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { planType } = req.body; // 'monthly' or 'yearly'

  if (!planType || !['monthly', 'yearly'].includes(planType)) {
    return res.status(400).json({ success: false, message: 'planType must be "monthly" or "yearly"' });
  }

  const planId = planType === 'monthly'
    ? process.env.RAZORPAY_PLAN_MONTHLY
    : process.env.RAZORPAY_PLAN_YEARLY;

  if (!planId) {
    return res.status(500).json({ success: false, message: 'Plan not configured on server' });
  }

  const razorpay = getRazorpay();

  // Create subscription via Razorpay API
  const subscription = await razorpay.subscriptions.create({
    plan_id: planId,
    customer_notify: 1,
    total_count: planType === 'monthly' ? 12 : 1,
  });

  // Save subscription ID to User
  await User.findByIdAndUpdate(userId, {
    razorpaySubId: subscription.id,
  });

  // Save payment record in MongoDB
  await Payment.create({
    userId,
    razorpaySubscriptionId: subscription.id,
    planId,
    planType,
    status: 'created',
  });

  res.json({
    success: true,
    data: {
      subscriptionId: subscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    },
  });
});

/**
 * POST /payments/verify
 * Verifies Razorpay payment signature after checkout and activates subscription.
 */
export const verifyPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_signature,
  } = req.body;

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Missing payment verification fields' });
  }

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    // Mark payment as failed
    await Payment.findOneAndUpdate(
      { razorpaySubscriptionId: razorpay_subscription_id },
      { status: 'failed' }
    );
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  // Fetch subscription details from Razorpay for amount
  const razorpay = getRazorpay();
  let subscriptionDetails: any;
  try {
    subscriptionDetails = await razorpay.subscriptions.fetch(razorpay_subscription_id);
  } catch (e) {
    console.error('[Payment] Could not fetch subscription details:', e);
  }

  // Determine subscription duration
  const planType = subscriptionDetails?.plan_id === process.env.RAZORPAY_PLAN_YEARLY ? 'yearly' : 'monthly';
  const durationMonths = planType === 'yearly' ? 12 : 1;
  const subscriptionEndDate = new Date();
  subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + durationMonths);

  // Update payment record
  await Payment.findOneAndUpdate(
    { razorpaySubscriptionId: razorpay_subscription_id },
    {
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      amount: subscriptionDetails?.plan?.item?.amount, // in paise
      status: 'active',
      paidAt: new Date(),
    }
  );

  // Activate user subscription
  await User.findByIdAndUpdate(userId, {
    subscriptionStatus: 'active',
    subscriptionEndDate,
    razorpaySubId: razorpay_subscription_id,
  });

  res.json({
    success: true,
    message: 'Payment verified and subscription activated',
    data: {
      subscriptionStatus: 'active',
      subscriptionEndDate,
    },
  });
});

/**
 * GET /payments/status
 * Returns current subscription status for the authenticated user.
 */
export const getPaymentStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  res.json({
    success: true,
    data: {
      status: user.subscriptionStatus,
      expiryDate: user.subscriptionEndDate,
      razorpaySubId: user.razorpaySubId,
    },
  });
});

/**
 * GET /payments/history
 * Returns payment history for the authenticated user.
 */
export const getPaymentHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const payments = await Payment.find({ userId })
    .sort({ createdAt: -1 })
    .select('planType amount status paidAt createdAt');

  res.json({
    success: true,
    data: payments,
  });
});

/**
 * POST /payments/webhook
 * Razorpay webhook — the ONLY trusted source of payment confirmation.
 * CRITICAL: Never trust frontend success. Only trust this webhook.
 * 
 * Events handled:
 *   - subscription.charged → payment success, activate subscription
 *   - subscription.cancelled → mark cancelled
 *   - payment.failed → mark failed
 */
export const razorpayWebhook = async (req: Request, res: Response) => {
  try {
    // Step 1: Verify HMAC signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET!;
    const receivedSignature = req.headers['x-razorpay-signature'] as string;

    if (!receivedSignature) {
      console.error('[Webhook] Missing x-razorpay-signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    // req.body must be raw string/buffer for HMAC verification
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== receivedSignature) {
      console.error('[Webhook] Signature mismatch! Rejecting.');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Step 2: Parse event
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.event;

    console.log(`[Webhook] Received event: ${eventType}`);

    // Step 3: Handle events
    if (eventType === 'subscription.charged' || eventType === 'payment.captured') {
      const paymentEntity = event.payload?.payment?.entity;
      const subscriptionEntity = event.payload?.subscription?.entity;

      if (!paymentEntity) {
        console.error('[Webhook] No payment entity in payload');
        return res.status(200).json({ status: 'ok' }); // Return 200 so Razorpay doesn't retry
      }

      const razorpayPaymentId = paymentEntity.id;
      const razorpaySubscriptionId = subscriptionEntity?.id || paymentEntity.subscription_id;
      const amount = paymentEntity.amount; // in paise
      const method = paymentEntity.method; // upi, card, netbanking, wallet
      const email = paymentEntity.email;
      const contact = paymentEntity.contact;

      console.log(`[Webhook] Payment: ${razorpayPaymentId}, Sub: ${razorpaySubscriptionId}, Amount: ${amount}, Method: ${method}`);

      // Find the payment record by subscription ID
      const paymentRecord = await Payment.findOne({ razorpaySubscriptionId });

      if (paymentRecord) {
        // Update existing payment record
        paymentRecord.razorpayPaymentId = razorpayPaymentId;
        paymentRecord.amount = amount;
        paymentRecord.method = method;
        paymentRecord.status = 'active';
        paymentRecord.paidAt = new Date();
        await paymentRecord.save();

        // Determine subscription end date
        const planType = paymentRecord.planType;
        const durationMonths = planType === 'yearly' ? 12 : 1;
        const subscriptionEndDate = new Date();
        subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + durationMonths);

        // Activate user subscription — THE REAL ACTIVATION
        await User.findByIdAndUpdate(paymentRecord.userId, {
          subscriptionStatus: 'active',
          subscriptionEndDate,
          razorpaySubId: razorpaySubscriptionId,
        });

        console.log(`[Webhook] ✅ User ${paymentRecord.userId} subscription activated until ${subscriptionEndDate}`);
      } else {
        // Payment record not found — create one (edge case: webhook arrived before create-subscription response)
        console.warn(`[Webhook] No payment record found for sub: ${razorpaySubscriptionId}. Finding user by razorpaySubId.`);
        
        const user = await User.findOne({ razorpaySubId: razorpaySubscriptionId });
        if (user) {
          await Payment.create({
            userId: user._id,
            razorpayPaymentId,
            razorpaySubscriptionId,
            planId: subscriptionEntity?.plan_id || 'unknown',
            planType: 'monthly', // default
            amount,
            method,
            status: 'active',
            paidAt: new Date(),
          });

          const subscriptionEndDate = new Date();
          subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);

          await User.findByIdAndUpdate(user._id, {
            subscriptionStatus: 'active',
            subscriptionEndDate,
          });

          console.log(`[Webhook] ✅ User ${user._id} activated via fallback.`);
        } else {
          console.error(`[Webhook] Could not find user for subscription: ${razorpaySubscriptionId}`);
        }
      }
    } else if (eventType === 'subscription.cancelled') {
      const subscriptionId = event.payload?.subscription?.entity?.id;
      if (subscriptionId) {
        await Payment.findOneAndUpdate(
          { razorpaySubscriptionId: subscriptionId },
          { status: 'cancelled' }
        );

        const user = await User.findOne({ razorpaySubId: subscriptionId });
        if (user) {
          await User.findByIdAndUpdate(user._id, { subscriptionStatus: 'expired' });
          console.log(`[Webhook] User ${user._id} subscription cancelled.`);
        }
      }
    } else if (eventType === 'payment.failed') {
      const paymentEntity = event.payload?.payment?.entity;
      const subscriptionId = paymentEntity?.subscription_id;
      if (subscriptionId) {
        await Payment.findOneAndUpdate(
          { razorpaySubscriptionId: subscriptionId },
          { status: 'failed' }
        );
        console.log(`[Webhook] Payment failed for sub: ${subscriptionId}`);
      }
    }

    // Always return 200 to Razorpay so it doesn't retry
    res.status(200).json({ status: 'ok' });
  } catch (error: any) {
    console.error('[Webhook] Error processing webhook:', error);
    // Still return 200 to prevent infinite retries
    res.status(200).json({ status: 'ok' });
  }
};
