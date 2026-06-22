export const messages: Record<string, Record<string, string>> = {
  unauthorized: {
    en: 'Unauthorized access. Please log in.',
    hi: 'अनधिकृत पहुंच। कृपया लॉग इन करें।'
  },
  user_not_found: {
    en: 'User not found.',
    hi: 'उपयोगकर्ता नहीं मिला।'
  },
  test_not_found: {
    en: 'Test not found.',
    hi: 'टेस्ट नहीं मिला।'
  },
  test_already_submitted: {
    en: 'Test already submitted.',
    hi: 'टेस्ट पहले ही सबमिट किया जा चुका है।'
  },
  invalid_signature: {
    en: 'Invalid signature.',
    hi: 'अमान्य हस्ताक्षर।'
  },
  missing_config: {
    en: 'Missing configuration or signature.',
    hi: 'कॉन्फ़िगरेशन या हस्ताक्षर गायब है।'
  },
  invalid_plan_type: {
    en: 'Plan type must be "monthly" or "yearly".',
    hi: 'प्लान का प्रकार "monthly" या "yearly" होना चाहिए।'
  },
  payment_verified: {
    en: 'Payment verified and subscription activated successfully.',
    hi: 'भुगतान सत्यापित और सदस्यता सफलतापूर्वक सक्रिय हो गई।'
  },
  invalid_vpa: {
    en: 'Please enter a valid UPI ID (e.g. name@bank).',
    hi: 'कृपया एक मान्य UPI ID दर्ज करें (जैसे name@bank)।'
  },
  subscription_not_found: {
    en: 'Subscription not found. Please start again.',
    hi: 'सदस्यता नहीं मिली। कृपया फिर से शुरू करें।'
  },
  upi_autopay_failed: {
    en: 'Could not start the UPI Autopay request. Please try another method.',
    hi: 'UPI ऑटोपे अनुरोध शुरू नहीं हो सका। कृपया कोई अन्य तरीका आज़माएँ।'
  },
  upi_mandate_pending: {
    en: 'Approve the Autopay request in your UPI app to activate Premium.',
    hi: 'प्रीमियम सक्रिय करने के लिए अपने UPI ऐप में ऑटोपे अनुरोध स्वीकार करें।'
  },
  phone_required: {
    en: 'Phone number is required.',
    hi: 'फोन नंबर आवश्यक है।'
  },
  phone_otp_required: {
    en: 'Phone and OTP are required.',
    hi: 'फोन और ओटीपी आवश्यक हैं।'
  },
  token_required: {
    en: 'Refresh token is required.',
    hi: 'रिफ्रेश टोकन आवश्यक है।'
  },
  logged_in: {
    en: 'Logged in successfully.',
    hi: 'सफलतापूर्वक लॉग इन किया गया।'
  },
  token_refreshed: {
    en: 'Token refreshed successfully.',
    hi: 'टोकन सफलतापूर्वक रिफ्रेश किया गया।'
  },
  profile_updated: {
    en: 'Profile updated successfully.',
    hi: 'प्रोफ़ाइल सफलतापूर्वक अपडेट की गई।'
  },
  exam_type_updated: {
    en: 'Exam type updated successfully.',
    hi: 'परीक्षा का प्रकार सफलतापूर्वक अपडेट किया गया।'
  },
  language_updated: {
    en: 'Preferred language updated successfully.',
    hi: 'पसंदीदा भाषा सफलतापूर्वक अपडेट की गई।'
  },
  invalid_exam_type: {
    en: 'Invalid exam type.',
    hi: 'अमान्य परीक्षा प्रकार।'
  },
  internal_error: {
    en: 'Internal server error.',
    hi: 'आंतरिक सर्वर त्रुटि।'
  },
  payment_processing: {
    en: 'A payment is already being processed. Please wait a few minutes.',
    hi: 'एक भुगतान पहले से ही प्रोसेस किया जा रहा है। कृपया कुछ मिनट प्रतीक्षा करें।'
  },
  already_active_sub: {
    en: 'You already have an active subscription.',
    hi: 'आपके पास पहले से ही एक सक्रिय सदस्यता है।'
  },
  SUBSCRIPTION_EXPIRED: {
    en: 'Your subscription has expired. Please renew to continue.',
    hi: 'आपकी सदस्यता समाप्त हो गई है। जारी रखने के लिए कृपया रिन्यू करें।'
  },
  TRIAL_EXPIRED: {
    en: 'Your 7-day trial has expired. Please subscribe to continue.',
    hi: 'आपका 7 दिनों का ट्रायल समाप्त हो गया है। जारी रखने के लिए कृपया सदस्यता लें।'
  },
  SUBSCRIPTION_REQUIRED: {
    en: 'A premium subscription is required to access this feature.',
    hi: 'इस फीचर तक पहुंचने के लिए प्रीमियम सदस्यता आवश्यक है।'
  }
};

export const getMessage = (key: string, lang: string = 'en'): string => {
  const langLower = lang.toLowerCase().startsWith('hi') ? 'hi' : 'en';
  return messages[key]?.[langLower] || messages[key]?.['en'] || key;
};
