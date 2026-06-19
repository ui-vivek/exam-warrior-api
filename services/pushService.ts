import { getFirebaseAdmin } from '@/lib/firebase';
import { UserDevice } from '@/model/userDevice.model';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  // Android notification channel: 'reminders' (routine nudges the user can mute)
  // or 'updates' (results, rankings, account). Defaults to 'updates'.
  channelId?: string;
}

/**
 * Sends an FCM notification to all devices of the given users. Cleans up tokens
 * that FCM reports as invalid/unregistered. Safe no-op if Firebase isn't
 * configured or there are no tokens.
 */
export const sendPushToUsers = async (
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; tokens: number }> => {
  const admin = getFirebaseAdmin();
  if (!admin || userIds.length === 0) return { sent: 0, failed: 0, tokens: 0 };

  const devices = await UserDevice.find({
    userId: { $in: userIds },
    deviceToken: { $exists: true, $nin: [null, ''] },
  })
    .select('deviceToken')
    .lean();

  const tokens = devices
    .map((d: any) => d.deviceToken as string)
    .filter(Boolean);
  if (tokens.length === 0) return { sent: 0, failed: 0, tokens: 0 };

  let sent = 0;
  let failed = 0;
  const invalid: string[] = [];

  // Route to a named channel and carry it in data too, so the app shows
  // foreground notifications on the same channel.
  const channelId = payload.channelId || 'updates';
  const data = { ...(payload.data || {}), channelId };

  // FCM multicast supports up to 500 tokens per call.
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title: payload.title, body: payload.body },
      data,
      android: {
        priority: 'high',
        notification: { channelId },
      },
    });
    sent += res.successCount;
    failed += res.failureCount;
    res.responses.forEach((r: any, idx: number) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument') ||
          code.includes('invalid-registration-token')
        ) {
          invalid.push(chunk[idx]);
        }
      }
    });
  }

  if (invalid.length > 0) {
    await UserDevice.updateMany(
      { deviceToken: { $in: invalid } },
      { $unset: { deviceToken: '' } },
    );
  }

  return { sent, failed, tokens: tokens.length };
};

/**
 * Sends the daily test reminder to every user that has a registered device.
 * Shared by the in-server cron and the HTTP cron endpoint.
 */
export const sendDailyReminderToAll = async () => {
  const userIds: any[] = await UserDevice.find({
    deviceToken: { $exists: true, $nin: [null, ''] },
  }).distinct('userId');

  const result = await sendPushToUsers(userIds.map((id) => id.toString()), {
    title: 'Today’s test is ready 📘',
    body: 'Your daily practice set is waiting. Take it now to keep your streak going.',
    data: { type: 'daily_reminder' },
    channelId: 'reminders',
  });

  return { users: userIds.length, ...result };
};
