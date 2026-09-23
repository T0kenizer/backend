import { GameLifecycleConsumer } from '@modules/game-core/game-lifecycle.consumer';
import * as Types from '@modules/game-core/game-lifecycle.types';
import type { GamePresenceService } from '@modules/game-core/game-presence.service';
import type { GameRoomsService } from '@modules/game-core/game-rooms.service';

const GAME_UUID = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';

function build() {
  const rooms = {
    releaseEmptyRoom: jest.fn().mockResolvedValue(undefined),
    announceDeparture: jest.fn().mockResolvedValue(undefined),
    sweepIdleRooms: jest.fn().mockResolvedValue(0),
  };
  const presence = {
    isRoomEmpty: jest.fn().mockReturnValue(true),
    isParticipantConnected: jest.fn().mockReturnValue(false),
  };
  const consumer = new GameLifecycleConsumer(
    rooms as unknown as GameRoomsService,
    presence as unknown as GamePresenceService,
  );
  return { consumer, rooms, presence };
}

function job<Name extends Types.GameLifecycleJob>(
  name: Name,
  data: Types.GameLifecycleJobData[Name],
) {
  return { name, data } as Types.GameLifecycleQueueJob;
}

describe('GameLifecycleConsumer', () => {
  describe('release-empty-room', () => {
    it('closes a room that is still empty when the job fires', async () => {
      const { consumer, rooms } = build();

      await consumer.process(
        job(Types.GameLifecycleJob.ReleaseEmptyRoom, { gameUuid: GAME_UUID }),
      );

      expect(rooms.releaseEmptyRoom).toHaveBeenCalledWith(GAME_UUID);
    });

    it('leaves the session alone when someone rejoined in the meantime', async () => {
      const { consumer, rooms, presence } = build();
      // The job was queued five minutes ago on an empty room; a player came
      // back since. Closing under them would be worse than never closing.
      presence.isRoomEmpty.mockReturnValue(false);

      await consumer.process(
        job(Types.GameLifecycleJob.ReleaseEmptyRoom, { gameUuid: GAME_UUID }),
      );

      expect(rooms.releaseEmptyRoom).not.toHaveBeenCalled();
    });
  });

  describe('player-disconnected', () => {
    it('announces a departure when the seat never came back', async () => {
      const { consumer, rooms } = build();

      await consumer.process(
        job(Types.GameLifecycleJob.PlayerDisconnected, {
          gameUuid: GAME_UUID,
          participantId: PARTICIPANT_ID,
        }),
      );

      expect(rooms.announceDeparture).toHaveBeenCalledWith(
        GAME_UUID,
        PARTICIPANT_ID,
      );
    });

    it('says nothing when the player reconnected inside the tolerance', async () => {
      const { consumer, rooms, presence } = build();
      // A page refresh: the socket dropped and a new one is already in the
      // room, speaking for the same seat.
      presence.isParticipantConnected.mockReturnValue(true);

      await consumer.process(
        job(Types.GameLifecycleJob.PlayerDisconnected, {
          gameUuid: GAME_UUID,
          participantId: PARTICIPANT_ID,
        }),
      );

      expect(rooms.announceDeparture).not.toHaveBeenCalled();
    });
  });

  it('runs the stale sweep on its scheduled tick', async () => {
    const { consumer, rooms } = build();

    await consumer.process(job(Types.GameLifecycleJob.SweepStaleSessions, {}));

    expect(rooms.sweepIdleRooms).toHaveBeenCalledTimes(1);
  });
});
