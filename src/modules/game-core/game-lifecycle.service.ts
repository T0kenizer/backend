import * as Constants from '@modules/game-core/game-core.constants';
import * as Types from '@modules/game-core/game-lifecycle.types';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class GameLifecycleService implements OnModuleInit {
  private readonly logger = new Logger(GameLifecycleService.name);

  constructor(
    @InjectQueue(Constants.GAME_LIFECYCLE_QUEUE)
    private readonly queue: Types.GameLifecycleQueue,
  ) {}

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

  public async scheduleRoomRelease(gameUuid: string): Promise<void> {
    await this.queue.add(
      Types.GameLifecycleJob.ReleaseEmptyRoom,
      { gameUuid },
      {
        jobId: Types.releaseEmptyRoomJobId(gameUuid),
        delay: Constants.ROOM_EMPTY_GRACE_MS,
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    );
    this.logger.log(
      `Room ${gameUuid} is empty; releasing it in ${Constants.ROOM_EMPTY_GRACE_MS / 60_000}min unless someone joins`,
    );
  }

  public async scheduleRoomTeardown(gameUuid: string): Promise<void> {
    await this.queue.add(
      Types.GameLifecycleJob.TeardownClosedRoom,
      { gameUuid },
      {
        jobId: Types.teardownClosedRoomJobId(gameUuid),
        delay: Constants.CLOSED_ROOM_GRACE_MS,
        removeOnComplete: true,
        removeOnFail: { age: 3600 },
      },
    );
  }

  public async cancelRoomTeardown(gameUuid: string): Promise<void> {
    await this.remove(Types.teardownClosedRoomJobId(gameUuid));
  }

  public async cancelRoomRelease(gameUuid: string): Promise<void> {
    await this.remove(Types.releaseEmptyRoomJobId(gameUuid));
  }

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

  public async cancelPlayerDeparture(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.remove(Types.playerDisconnectedJobId(gameUuid, participantId));
  }

  private async remove(jobId: string): Promise<void> {
    try {
      await this.queue.remove(jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Could not remove job ${jobId}: ${message}`);
    }
  }
}
