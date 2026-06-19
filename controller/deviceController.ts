import { Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';
import { UserDevice } from '@/model/userDevice.model';

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
