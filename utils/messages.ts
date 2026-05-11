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
  }
};

export const getMessage = (key: string, lang: string = 'en'): string => {
  const langLower = lang.toLowerCase().startsWith('hi') ? 'hi' : 'en';
  return messages[key]?.[langLower] || messages[key]?.['en'] || key;
};
