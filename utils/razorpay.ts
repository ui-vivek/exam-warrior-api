import Razorpay from 'razorpay';

let _instance: InstanceType<typeof Razorpay> | null = null;

export const getRazorpay = (): InstanceType<typeof Razorpay> => {
  if (!_instance) {
    _instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
  }
  return _instance;
};

/** Normalised view of a Razorpay SDK error (shape: { statusCode, error:{...} }). */
export interface RazorpayErrorInfo {
  statusCode?: number;
  code?: string;
  description?: string;
}

export const razorpayErrorInfo = (err: any): RazorpayErrorInfo => {
  const inner = err?.error ?? err;
  return {
    statusCode: err?.statusCode ?? inner?.statusCode,
    code: inner?.code,
    description: inner?.description ?? err?.message,
  };
};

/**
 * True when a Razorpay error means the S2S / Custom Checkout feature (VPA
 * validation, server-side UPI charge, UPI Autopay) is NOT enabled on the
 * account — as opposed to a genuine user error like a wrong VPA.
 *
 * These features must be activated by Razorpay support before they work on a
 * live account (Exam Warrior ticket #19494787). Until then these calls fail and
 * the app must fall back to Razorpay's hosted Standard Checkout. We classify
 * conservatively: auth/permission errors and "not enabled / not allowed"
 * descriptions are treated as "feature unavailable".
 */
export const isS2SUnavailable = (err: any): boolean => {
  const { statusCode, code, description } = razorpayErrorInfo(err);
  if (statusCode === 401 || statusCode === 403) return true;
  const text = `${code ?? ''} ${description ?? ''}`.toLowerCase();
  return (
    text.includes('not enabled') ||
    text.includes('not allowed') ||
    text.includes('not activated') ||
    text.includes('not permitted') ||
    text.includes('no permission') ||
    text.includes('permission') ||
    text.includes('feature') ||
    text.includes('access is denied') ||
    text.includes('merchant is not')
  );
};

/**
 * Validates a UPI VPA (e.g. "name@bank") via Razorpay's S2S VPA validation API.
 * Returns the customer name when the VPA is real. Requires S2S to be enabled.
 */
export const validateVpa = (vpa: string) =>
  getRazorpay().payments.validateVpa({ vpa });

/** Params for initiating a UPI Autopay (mandate) authorization charge. */
export interface UpiAutopayChargeParams {
  amount: number; // in paise
  email: string;
  contact: string;
  subscriptionId: string;
  vpa: string;
  ip?: string;
  referer?: string;
  userAgent?: string;
}

/**
 * Initiates the UPI Autopay mandate authorization via S2S using the UPI
 * "collect" flow against a user-typed VPA. The user then approves the mandate
 * in their UPI app; the `subscription.charged` / `subscription.authenticated`
 * webhook is the trusted source that activates Premium.
 *
 * Note: charging a typed VPA IS the UPI collect flow — it is the only way to
 * bill a VPA the user enters by hand (UPI intent/QR never take a typed VPA).
 */
export const createUpiAutopayCharge = (params: UpiAutopayChargeParams) => {
  const body: Record<string, unknown> = {
    amount: params.amount,
    currency: 'INR',
    email: params.email,
    contact: params.contact,
    subscription_id: params.subscriptionId,
    recurring: 1,
    method: 'upi',
    ip: params.ip || '127.0.0.1',
    referer: params.referer || 'https://examwarrior.in',
    user_agent: params.userAgent || 'ExamWarriorApp',
    upi: { flow: 'collect', vpa: params.vpa, expiry_time: 5 },
  };
  // Cast: the subscription authorization body uses subscription_id (no order_id)
  // and a `recurring` flag, which the typed SDK signature does not model.
  return getRazorpay().payments.createUpi(body as any);
};

/** Params for creating a UPI Autopay authorization via the intent flow. */
export interface UpiIntentChargeParams {
  amount: number; // in paise
  email: string;
  contact: string;
  subscriptionId: string;
  ip?: string;
  referer?: string;
  userAgent?: string;
}

/**
 * Creates a UPI Autopay mandate authorization via the UPI "intent" flow (no
 * typed VPA). Razorpay returns an intent URL (`link`, e.g. "upi://...") that the
 * app uses two ways:
 *   1. launch a chosen installed UPI app (Google Pay / PhonePe / Paytm…), and
 *   2. render as a QR code the user can scan from another device.
 * Requires S2S / Custom Checkout enabled on the account.
 */
export const createUpiIntentCharge = (params: UpiIntentChargeParams) => {
  const body: Record<string, unknown> = {
    amount: params.amount,
    currency: 'INR',
    email: params.email,
    contact: params.contact,
    subscription_id: params.subscriptionId,
    recurring: 1,
    method: 'upi',
    ip: params.ip || '127.0.0.1',
    referer: params.referer || 'https://examwarrior.in',
    user_agent: params.userAgent || 'ExamWarriorApp',
    upi: { flow: 'intent' },
  };
  return getRazorpay().payments.createUpi(body as any);
};
