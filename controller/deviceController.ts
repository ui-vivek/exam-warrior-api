import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';
import { UserDevice } from '@/model/userDevice.model';
import { sendPushToUsers, sendDailyReminderToAll } from '@/services/pushService';
import { getFirebaseAdmin } from '@/lib/firebase';

/**
 * POST /devices/register  { deviceId, deviceType?, deviceToken?, appVersion? }
 * Registers/refreshes this install's device row for the user. Keyed by the
 * stable deviceId, so a rotated push token just updates the existing row.
 */
export const registerDevice = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const deviceId = String(req.body.deviceId || '').trim();
  if (!deviceId) throw new AppError('device_id_required', 400);

  const deviceType = ['android', 'ios', 'web'].includes(req.body.deviceType)
    ? req.body.deviceType
    : 'android';
  const deviceToken = req.body.deviceToken
    ? String(req.body.deviceToken).trim()
    : undefined;
  const appVersion = req.body.appVersion ? String(req.body.appVersion) : undefined;

  // One row per (user, install) — upsert by deviceId.
  const device = await UserDevice.findOneAndUpdate(
    { userId, deviceId },
    { userId, deviceId, deviceType, deviceToken, appVersion, lastSeenAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // A push token lives on exactly one device row. If this token was previously
  // registered elsewhere (token migrated to a new install/user), drop it there.
  if (deviceToken) {
    await UserDevice.updateMany(
      { deviceToken, _id: { $ne: device._id } },
      { $unset: { deviceToken: '' } },
    );
  }

  res.json({ success: true, data: { id: device._id } });
});

/**
 * POST /devices/unregister  { deviceId? , deviceToken? }
 * Removes a device (e.g. on logout) so it stops receiving pushes.
 */
export const unregisterDevice = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const deviceId = req.body.deviceId ? String(req.body.deviceId).trim() : undefined;
  const deviceToken = req.body.deviceToken
    ? String(req.body.deviceToken).trim()
    : undefined;
  if (!deviceId && !deviceToken) throw new AppError('device_id_required', 400);

  await UserDevice.deleteOne({
    userId,
    ...(deviceId ? { deviceId } : { deviceToken }),
  });
  res.json({ success: true, data: { removed: true } });
});

/**
 * POST /devices/test-push — sends a test FCM notification to the caller's own
 * devices. Handy for verifying push works end-to-end on a real phone.
 */
export const sendTestPush = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  // Diagnostics: is the server able to talk to FCM, and does this user have a token?
  const firebaseReady = !!getFirebaseAdmin();
  const tokensForUser = await UserDevice.countDocuments({
    userId,
    deviceToken: { $exists: true, $nin: [null, ''] },
  });

  const result = await sendPushToUsers([userId], {
    title: 'Exam Warrior',
    body: 'Notifications are set up correctly.',
    data: { type: 'test' },
    channelId: 'updates',
  });

  // Plain-English reason so you can diagnose from the API response alone.
  let hint: string;
  if (!firebaseReady) {
    hint = 'Server has NO Firebase service account. Set FIREBASE_SERVICE_ACCOUNT (or FIREBASE_SERVICE_ACCOUNT_PATH) on Render and redeploy.';
  } else if (tokensForUser === 0) {
    hint = 'No device token saved for this user. Open the app, allow notifications, and let it register a device.';
  } else if (result.sent > 0) {
    hint = 'Sent! Check your phone.';
  } else {
    hint = 'FCM rejected the token (stale). Relaunch/reinstall the app to refresh the token, then try again.';
  }

  res.json({ success: true, data: { firebaseReady, tokensForUser, ...result, hint } });
});

/**
 * POST /notifications/cron/daily-reminder — sends the daily test reminder to
 * every user that has a registered device. Protected by a shared secret so an
 * external scheduler (cron-job.org / GitHub Actions / UptimeRobot) can call it.
 * Header: x-cron-secret: <CRON_SECRET>.
 */
export const cronDailyReminder = asyncHandler(async (req: Request, res: Response) => {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    throw new AppError('unauthorized', 401);
  }

  const result = await sendDailyReminderToAll();
  res.json({ success: true, data: result });
});
