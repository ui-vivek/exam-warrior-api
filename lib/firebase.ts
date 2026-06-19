import admin from 'firebase-admin';

let initialized = false;
let cached: typeof admin | null = null;

/**
 * Lazily initialises firebase-admin from the FIREBASE_SERVICE_ACCOUNT env var
 * (the full service-account JSON, stringified). Returns null if not configured
 * so push simply no-ops instead of crashing.
 *
 * On Render: Settings → Environment → add FIREBASE_SERVICE_ACCOUNT with the
 * contents of the service-account key JSON.
 */
export const getFirebaseAdmin = (): typeof admin | null => {
  if (initialized) return cached;
  initialized = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[Push] FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled.');
    cached = null;
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    cached = admin;
    console.log('[Push] firebase-admin initialised.');
    return admin;
  } catch (e) {
    console.error('[Push] Failed to init firebase-admin:', (e as Error).message);
    cached = null;
    return null;
  }
};
