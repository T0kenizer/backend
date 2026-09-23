import * as Constants from '@modules/game-core/game-core.constants';
import { GameLifecycleService } from '@modules/game-core/game-lifecycle.service';
import * as Types from '@modules/game-core/game-lifecycle.types';

const GAME_UUID = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';

function build() {
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
  };
  const service = new GameLifecycleService(
    queue as unknown as Types.GameLifecycleQueue,
  );
  return { service, queue };
}

describe('GameLifecycleService', () => {
  it('registers the stale sweep as one scheduler, not one job per boot', async () => {
    const { service, queue } = build();

    await service.onModuleInit();
    await service.onModuleInit();

    // Upserting by a fixed id is what stops a restart loop from stacking
    // schedules until the sweep runs continuously.
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      Types.GameLifecycleJob.SweepStaleSessions,
      { pattern: Constants.STALE_SWEEP_CRON },
      expect.objectContaining({
        name: Types.GameLifecycleJob.SweepStaleSessions,
      }),
    );
  });

  it('defers an empty room closure under a job id derived from the game', async () => {
    const { service, queue } = build();

    await service.scheduleRoomRelease(GAME_UUID);

    expect(queue.add).toHaveBeenCalledWith(
      Types.GameLifecycleJob.ReleaseEmptyRoom,
      { gameUuid: GAME_UUID },
      expect.objectContaining({
        jobId: Types.releaseEmptyRoomJobId(GAME_UUID),
        delay: Constants.ROOM_EMPTY_GRACE_MS,
      }),
    );
  });

  it('cancels a pending closure by that same derived id', async () => {
    const { service, queue } = build();

    await service.scheduleRoomRelease(GAME_UUID);
    await service.cancelRoomRelease(GAME_UUID);

    // The derived id is the entire reason a join can call this off without
    // having kept a handle on the job.
    expect(queue.remove).toHaveBeenCalledWith(
      Types.releaseEmptyRoomJobId(GAME_UUID),
    );
  });

  it('defers a player departure by the short tolerance, per seat', async () => {
    const { service, queue } = build();

    await service.schedulePlayerDeparture(GAME_UUID, PARTICIPANT_ID);

    expect(queue.add).toHaveBeenCalledWith(
      Types.GameLifecycleJob.PlayerDisconnected,
      { gameUuid: GAME_UUID, participantId: PARTICIPANT_ID },
      expect.objectContaining({
        jobId: Types.playerDisconnectedJobId(GAME_UUID, PARTICIPANT_ID),
        delay: Constants.PLAYER_DISCONNECT_GRACE_MS,
      }),
    );
  });

  it('cancels a player departure when they reconnect in time', async () => {
    const { service, queue } = build();

    await service.schedulePlayerDeparture(GAME_UUID, PARTICIPANT_ID);
    await service.cancelPlayerDeparture(GAME_UUID, PARTICIPANT_ID);

    expect(queue.remove).toHaveBeenCalledWith(
      Types.playerDisconnectedJobId(GAME_UUID, PARTICIPANT_ID),
    );
  });

  it('treats removing an already-run job as success, not failure', async () => {
    const { service, queue } = build();
    queue.remove.mockRejectedValue(new Error('Missing key for job'));

    // Nothing pending is exactly what the caller wanted; the job having
    // already fired must not turn a reconnection into an error.
    await expect(service.cancelRoomRelease(GAME_UUID)).resolves.toBeUndefined();
  });

  it('keeps the two grace periods independent', () => {
    // A page refresh must never trip the room closure, so the per-player
    // tolerance has to be far shorter than the room's.
    expect(Constants.PLAYER_DISCONNECT_GRACE_MS).toBeLessThan(
      Constants.ROOM_EMPTY_GRACE_MS,
    );
    expect(Constants.PLAYER_DISCONNECT_GRACE_MS).toBeGreaterThanOrEqual(10_000);
    expect(Constants.PLAYER_DISCONNECT_GRACE_MS).toBeLessThanOrEqual(30_000);
  });
});

/**
 * BullMQ rejects a custom job id containing a colon, and it does so from inside
 * `queue.add` — which means a bad id does not break a test or raise an alert,
 * it just quietly leaves the deferred decision unarmed. Every id the module
 * mints is therefore checked here rather than trusted.
 */
describe('lifecycle job ids', () => {
  const GAME = '11111111-1111-4111-8111-111111111111';
  const SEAT = '22222222-2222-4222-8222-222222222222';

  it.each([
    ['release-empty-room', Types.releaseEmptyRoomJobId(GAME)],
    ['teardown-closed-room', Types.teardownClosedRoomJobId(GAME)],
    ['player-disconnected', Types.playerDisconnectedJobId(GAME, SEAT)],
  ])('mints %s without a colon BullMQ would refuse', (_name, jobId) => {
    expect(jobId).not.toContain(':');
  });

  it('keeps one id per room and per seat', () => {
    expect(Types.releaseEmptyRoomJobId(GAME)).not.toBe(
      Types.teardownClosedRoomJobId(GAME),
    );
    expect(Types.playerDisconnectedJobId(GAME, SEAT)).toContain(SEAT);
  });
});
