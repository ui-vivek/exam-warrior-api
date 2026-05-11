import { authMiddleware } from '@/middleware/authMiddleware';
import {
  createSubscription,
  verifyPayment,
  getPaymentStatus,
  getPaymentHistory,
  razorpayWebhook,
} from '@/controller/paymentController';

const express = require('express') as typeof import('express');
const router = express.Router();

// Create a new Razorpay subscription
router.post('/create-subscription', authMiddleware, createSubscription);

// Verify payment after Razorpay checkout (frontend fallback)
router.post('/verify', authMiddleware, verifyPayment);

// Razorpay webhook — THE trusted source of payment confirmation
// No authMiddleware — Razorpay calls this directly
router.post('/webhook', express.raw({ type: 'application/json' }), razorpayWebhook);

// Get subscription status
router.get('/status', authMiddleware, getPaymentStatus);

// Get payment history
router.get('/history', authMiddleware, getPaymentHistory);

export default router;
