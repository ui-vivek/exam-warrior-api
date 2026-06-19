import fs from 'fs';
import admin from 'firebase-admin';

let initialized = false;
let cached: typeof admin | null = null;

/**
 * Lazily initialises firebase-admin from the service-account key. Two ways to
 * provide it (in priority order):
 *   1. FIREBASE_SERVICE_ACCOUNT_PATH — path to the key JSON file (handy locally).
 *   2. FIREBASE_SERVICE_ACCOUNT — the key JSON content as a string (use on Render).
 * Returns null if neither is set, so push simply no-ops instead of crashing.
 */
export const getFirebaseAdmin = (): typeof admin | null => {
  if (initialized) return cached;
  initialized = true;

  let raw: string | undefined;

  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path) {
    try {
      raw = fs.readFileSync(path, 'utf8');
    } catch (e) {
      console.error(`[Push] Could not read FIREBASE_SERVICE_ACCOUNT_PATH (${path}):`, (e as Error).message);
    }
  }
  if (!raw) raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw) {
    console.warn('[Push] No service account (FIREBASE_SERVICE_ACCOUNT[_PATH]) — push disabled.');
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
