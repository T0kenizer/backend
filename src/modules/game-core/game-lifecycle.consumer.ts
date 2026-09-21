import * as Constants from '@modules/game-core/game-core.constants';
import * as Types from '@modules/game-core/game-lifecycle.types';
import { GamePresenceService } from '@modules/game-core/game-presence.service';
import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

/**
 * Runs the deferred lifecycle decisions.
 *
 * Every branch re-reads presence before acting. A job was scheduled because the
 * room looked empty minutes ago; by the time it runs, someone may have
 * reconnected, and closing the session under them would be worse than never
 * closing it at all. The check is cheap and the race is real, so it is not
 * optional.
 */
@Processor(Constants.GAME_LIFECYCLE_QUEUE, {
  concurrency: Constants.WORKER_CONCURRENCY,
})
export class GameLifecycleConsumer extends WorkerHost {
  private readonly logger = new Logger(GameLifecycleConsumer.name);

  constructor(
    private readonly rooms: GameRoomsService,
    private readonly presence: GamePresenceService,
  ) {
    super();
  }

  public async process(job: Types.GameLifecycleQueueJob): Promise<void> {
    switch (job.name) {
      case Types.GameLifecycleJob.CloseEmptyRoom: {
        const { gameUuid } = job.data;
        // Someone rejoined while the job sat in the queue.
        if (!this.presence.isRoomEmpty(gameUuid)) {
          this.logger.log(`Room ${gameUuid} refilled; leaving it open`);
          break;
        }
        await this.rooms.abandonGame(gameUuid);
        break;
      }

      case Types.GameLifecycleJob.PlayerDisconnected: {
        const { gameUuid, participantId } = job.data;
        // They refreshed the page and are already back.
        if (this.presence.isParticipantConnected(gameUuid, participantId))
          break;
        await this.rooms.announceDeparture(gameUuid, participantId);
        break;
      }

      case Types.GameLifecycleJob.SweepStaleSessions: {
        await this.rooms.sweepStaleSessions();
        break;
      }
    }
  }
}
