import * as Constants from '@modules/game-core/game-core.constants';
import * as Types from '@modules/game-core/game-lifecycle.types';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * Schedules every deferred lifecycle decision.
 *
 * These used to be `setTimeout`s held in a `Map` on the service. A restart — a
 * deploy, a crash, an OOM kill — dropped the whole map, and the rooms it was
 * tracking stayed open forever with nothing left to close them. A queue
 * survives the process, which is the entire reason for the indirection; the
 * periodic sweep below then covers the jobs the queue itself loses.
 */
@Injectable()
export class GameLifecycleService implements OnModuleInit {
  private readonly logger = new Logger(GameLifecycleService.name);

  constructor(
    @InjectQueue(Constants.GAME_LIFECYCLE_QUEUE)
    private readonly queue: Types.GameLifecycleQueue,
  ) {}

  /**
   * Registers the repeatable sweep once, at boot. Upserting by a fixed
   * scheduler id means every instance boot converges on one schedule instead of
   * stacking a new one each time.
   */
  public async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      Types.GameLifecycleJob.SweepStaleSessions,
      { pattern: Constants.STALE_SWEEP_CRON },
      {
        name: Types.GameLifecycleJob.SweepStaleSessions,
        data: {},
        opts: { removeOnComplete: true },
      },
    );
  }

  /**
   * Arms the closure of an empty room. The fixed job id makes this idempotent:
   * scheduling twice leaves one job, not two racing to close the same session.
   */
  public async scheduleRoomClosure(gameUuid: string): Promise<void> {
    await this.queue.add(
      Types.GameLifecycleJob.CloseEmptyRoom,
      { gameUuid },
      {
        jobId: Types.closeEmptyRoomJobId(gameUuid),
        delay: Constants.ROOM_EMPTY_GRACE_MS,
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    );
    this.logger.log(
      `Room ${gameUuid} is empty; closing in ${Constants.ROOM_EMPTY_GRACE_MS / 60_000}min unless someone joins`,
    );
  }

  /** Someone came back: drop the pending closure. */
  public async cancelRoomClosure(gameUuid: string): Promise<void> {
    await this.remove(Types.closeEmptyRoomJobId(gameUuid));
  }

  /**
   * Arms the "did they actually leave?" check for one seat. Short enough that a
   * genuine departure is noticed quickly, long enough that a page refresh never
   * trips it.
   */
  public async schedulePlayerDeparture(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.queue.add(
      Types.GameLifecycleJob.PlayerDisconnected,
      { gameUuid, participantId },
      {
        jobId: Types.playerDisconnectedJobId(gameUuid, participantId),
        delay: Constants.PLAYER_DISCONNECT_GRACE_MS,
        removeOnComplete: true,
        removeOnFail: { age: 3600 },
      },
    );
  }

  /** The player reconnected inside their grace period. */
  public async cancelPlayerDeparture(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.remove(Types.playerDisconnectedJobId(gameUuid, participantId));
  }

  /**
   * Removing a job that already ran, or never existed, is not a failure — both
   * mean there is nothing pending, which is what the caller wanted.
   */
  private async remove(jobId: string): Promise<void> {
    try {
      await this.queue.remove(jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Could not remove job ${jobId}: ${message}`);
    }
  }
}
