import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { getMessage } from '@/utils/messages';
import { LangRequest } from '@/middleware/languageMiddleware';
import mongoose from 'mongoose';
import { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest } from '@/middleware/authMiddleware';
import { User } from '@/model/user.model';
import { Payment } from '@/model/payment.model';
import { Subscription } from '@/model/subscription.model';
import { getRazorpay } from '@/utils/razorpay';
/**
 * POST /payments/create-subscription
 * Creates a Razorpay subscription for the authenticated user.
 */
export const createSubscription = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  // Check if user already has an active subscription to avoid double charging
  const existingUser = await User.findById(userId);
  if (existingUser?.subscriptionStatus === 'active') {
    throw new AppError('already_active_sub', 400);
  }

  const { planType } = req.body; // 'monthly' or 'yearly'

  if (!planType || !['monthly', 'yearly'].includes(planType)) {
    throw new AppError('invalid_plan_type', 400);
  }

  const planId = planType === 'monthly'
    ? process.env.RAZORPAY_PLAN_MONTHLY
    : process.env.RAZORPAY_PLAN_YEARLY;

  if (!planId) {
    throw new AppError('Plan not configured on server', 500);
  }

  // Resume a recent pending order ONLY if it is for the SAME plan the user is
  // requesting now. Switching plans (e.g. monthly -> yearly) must start a fresh
  // subscription, otherwise the user would be shown the old plan's amount.
  const pendingPayment = await Payment.findOne({
    userId,
    status: 'created',
    planType,
    createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
  });

  if (pendingPayment?.razorpaySubscriptionId) {
    try {
      const existing: any = await getRazorpay()
        .subscriptions.fetch(pendingPayment.razorpaySubscriptionId);
      // Double-check the live subscription is for this exact plan and is still
      // awaiting authorisation before resuming it.
      if (
        existing &&
        existing.plan_id === planId &&
        (existing.status === 'created' || existing.status === 'authenticated')
      ) {
        return res.json({
          success: true,
          data: {
            subscriptionId: existing.id,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            shortUrl: existing.short_url,
          },
        });
      }
    } catch (_e) {
      // Couldn't fetch it — fall through and create a fresh order.
    }
  }

  const razorpay = getRazorpay();

  // Create subscription via Razorpay API.
  // total_count is the max number of billing cycles Razorpay will auto-charge.
  // Razorpay requires a finite cap, so we set it high enough to act as
  // "renew until the user cancels": ~10 years of monthly, 10 years of yearly.
  const subscription = await razorpay.subscriptions.create({
    plan_id: planId,
    customer_notify: 1,
    total_count: planType === 'monthly' ? 120 : 10,
  });

  // Create Subscription record in MongoDB
  const subRecord = await Subscription.create({
    userId,
    razorpaySubscriptionId: subscription.id,
    planId,
    planType,
    status: 'created',
  });

  // Save subscription ID to User
  await User.findByIdAndUpdate(userId, {
    razorpaySubId: subscription.id,
    subscriptionId: subRecord._id,
  });

  // Save payment record in MongoDB (Initial record)
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
      // Razorpay-hosted checkout page; opening this lets the user pay without
      // bundling the native checkout SDK. The webhook activates on success.
      shortUrl: (subscription as any).short_url,
    },
  });
});

/**
 * POST /payments/verify
 * Verifies Razorpay payment signature after checkout and activates subscription.
 */
export const verifyPayment = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_signature,
  } = req.body;

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    throw new AppError('Missing payment verification fields', 400);
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
    throw new AppError('invalid_signature', 400);
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

  // Update Subscription record
  await Subscription.findOneAndUpdate(
    { razorpaySubscriptionId: razorpay_subscription_id },
    {
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: subscriptionEndDate,
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
    message: getMessage('payment_verified', req.lang),
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
export const getPaymentStatus = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const user = await User.findById(userId);
  if (!user) throw new AppError('user_not_found', 404);

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
export const getPaymentHistory = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

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
 */
export const razorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const receivedSignature = req.headers['x-razorpay-signature'] as string;

    if (!webhookSecret || !receivedSignature) {
      console.error('[Webhook] Missing webhook secret or signature header');
      throw new AppError('missing_config', 400);
    }

    // req.body is a Buffer because of express.raw() in server.ts
    const rawBody = req.body;
    
    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== receivedSignature) {
      console.error('[Webhook] Signature mismatch! Rejecting.');
      await session.abortTransaction();
      throw new AppError('invalid_signature', 400);
    }

    // Step 2: Parse event
    const event = JSON.parse(rawBody.toString());
    const eventType = event.event;

    console.log(`[Webhook] Received event: ${eventType}`);

    // Step 3: Handle events
    if (eventType === 'subscription.charged' || eventType === 'payment.captured') {
      const paymentEntity = event.payload?.payment?.entity;
      const subscriptionEntity = event.payload?.subscription?.entity;

      if (!paymentEntity) {
        console.error('[Webhook] No payment entity in payload');
        await session.abortTransaction();
        return res.status(200).json({ status: 'ok' });
      }

      const razorpayPaymentId = paymentEntity.id;
      const razorpaySubscriptionId = subscriptionEntity?.id || paymentEntity.subscription_id;
      const amount = paymentEntity.amount; // in paise
      const method = paymentEntity.method;

      // Idempotency check: Have we processed this payment ID already?
      const existingPayment = await Payment.findOne({ razorpayPaymentId }).session(session);
      if (existingPayment && existingPayment.status === 'active') {
        console.log(`[Webhook] Payment ${razorpayPaymentId} already processed. Skipping.`);
        await session.commitTransaction();
        return res.status(200).json({ status: 'ok' });
      }

      // Find the user/payment record
      let paymentRecord = await Payment.findOne({ razorpaySubscriptionId }).session(session);
      
      // If no record, try finding user to create one
      if (!paymentRecord) {
        const user = await User.findOne({ razorpaySubId: razorpaySubscriptionId }).session(session);
        if (user) {
          paymentRecord = new Payment({
            userId: user._id,
            razorpaySubscriptionId,
            planId: subscriptionEntity?.plan_id || 'unknown',
            planType: 'monthly', // default if missing
          });
        }
      }

      if (paymentRecord) {
        // Update payment record
        paymentRecord.razorpayPaymentId = razorpayPaymentId;
        paymentRecord.amount = amount;
        paymentRecord.method = method;
        paymentRecord.status = 'active';
        paymentRecord.paidAt = new Date();
        await paymentRecord.save({ session });

        // Calculate subscription end date
        const planType = paymentRecord.planType || 'monthly';
        const durationMonths = planType === 'yearly' ? 12 : 1;
        const subscriptionEndDate = new Date();
        subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + durationMonths);

        // Update Subscription document
        const subDoc = await Subscription.findOneAndUpdate(
          { razorpaySubscriptionId },
          {
            userId: paymentRecord.userId,
            planId: subscriptionEntity?.plan_id || paymentRecord.planId,
            planType: planType,
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: subscriptionEndDate,
          },
          { upsert: true, new: true, session }
        );

        // Update User profile
        await User.findByIdAndUpdate(paymentRecord.userId, {
          subscriptionStatus: 'active',
          subscriptionEndDate,
          razorpaySubId: razorpaySubscriptionId,
          subscriptionId: subDoc?._id,
        }, { session });

        console.log(`[Webhook] ✅ Successfully processed ${eventType} for User ${paymentRecord.userId}`);
      } else {
        console.error(`[Webhook] No user/payment record found for subscription: ${razorpaySubscriptionId}`);
      }
    } 
    
    // A renewal failed and Razorpay gave up retrying (halted), the user
    // cancelled, or the subscription ran its full course (completed). In every
    // case auto-renew has stopped, so the user must lose Premium — otherwise a
    // failed renewal would leave them on Premium for free.
    else if (
      eventType === 'subscription.cancelled' ||
      eventType === 'subscription.halted' ||
      eventType === 'subscription.completed'
    ) {
      const subscriptionId = event.payload?.subscription?.entity?.id;
      // 'halted' = renewal payments failed; 'cancelled'/'completed' = ended.
      // Subscription model has a 'halted' status; Payment model does not, so
      // pending payment rows are simply marked 'cancelled'.
      const subStatus = eventType === 'subscription.halted' ? 'halted' : 'cancelled';
      if (subscriptionId) {
        await Payment.updateMany(
          { razorpaySubscriptionId: subscriptionId, status: { $ne: 'active' } },
          { status: 'cancelled' },
          { session }
        );

        await Subscription.findOneAndUpdate(
          { razorpaySubscriptionId: subscriptionId },
          { status: subStatus, endedAt: new Date() },
          { session }
        );

        await User.findOneAndUpdate(
          { razorpaySubId: subscriptionId },
          { subscriptionStatus: 'expired' },
          { session }
        );

        console.log(`[Webhook] Subscription ${subscriptionId} -> ${eventType} (user downgraded).`);
      }
    }

    await session.commitTransaction();
    res.status(200).json({ status: 'ok' });

  } catch (error: any) {
    console.error('[Webhook] ERROR:', error.message);
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    // Always return 200 to Razorpay to prevent retry loops on logical errors
    res.status(200).json({ status: 'ok', error: error.message });
  } finally {
    session.endSession();
  }
});
