import { Room } from '@/model/room.model';
import { notifyClassroomResult } from '@/services/notificationService';

/**
 * Finalizes classroom rooms whose shared timer has elapsed. This is the ONLY
 * piece that needs a scheduler: when time runs out, participants whose app was
 * closed can't submit themselves, so the server must close the room for them.
 *
 * For each active, expired room it atomically:
 *   - marks every still-unsubmitted participant as score 0 (they didn't finish),
 *   - flips the room to 'finished' (guarded, so it happens once),
 *   - fires the "results ready" push to all participants.
 *
 * The query is index-backed ({status, endsAt}) and usually returns nothing, so
 * running it every minute is cheap.
 */
export const finalizeExpiredRooms = async () => {
  const now = new Date();
  const rooms = await Room.find({ status: 'active', endsAt: { $lte: now } })
    .select('code participants')
    .lean();

  let finalized = 0;
  let notified = 0;

  for (const room of rooms as any[]) {
    // Atomic finalize: only while still 'active' and still past the deadline.
    // arrayFilters lock just the unsubmitted participants (score still null).
    const flip = await Room.updateOne(
      { _id: room._id, status: 'active', endsAt: { $lte: now } },
      {
        $set: {
          status: 'finished',
          'participants.$[u].score': 0,
          'participants.$[u].finishedAt': now,
        },
      },
      { arrayFilters: [{ 'u.score': null }] },
    );
    if (flip.modifiedCount !== 1) continue; // a submit/another tick beat us to it

    finalized += 1;
    const recipients = (room.participants || []).map((p: any) => p.userId.toString());
    const res = await notifyClassroomResult(room.code, recipients);
    notified += res.sent;
  }

  return { finalized, notified };
};
