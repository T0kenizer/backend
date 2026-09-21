import { GameParticipant } from '@entities/game/game-participant.entity';
import { GameSession } from '@entities/game/game-session.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ConfigModule } from '@modules/config/config.module';
import { GameCodesService } from '@modules/game-core/game-codes.service';
import * as Constants from '@modules/game-core/game-core.constants';
import { GameLifecycleConsumer } from '@modules/game-core/game-lifecycle.consumer';
import { GameLifecycleService } from '@modules/game-core/game-lifecycle.service';
import { GamePresenceService } from '@modules/game-core/game-presence.service';
import { GameQrService } from '@modules/game-core/game-qr.service';
import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import { GameRuntimeController } from '@modules/game-core/game-runtime.controller';
import { GameRuntimeGateway } from '@modules/game-core/game-runtime.gateway';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import { GameSessionsService } from '@modules/game-core/game-sessions.service';
import { GameTokensService } from '@modules/game-core/game-tokens.service';
import { RedisModule } from '@modules/redis/redis.module';
import { UsersModule } from '@modules/users/users.module';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

/**
 * GameCore runtime module.
 *
 * The split of responsibilities is the point of this module:
 *
 * - `GameSessionsService` owns the persisted rows — the source of truth for
 *   status, seats, balances and activity.
 * - `GameRuntimeService` holds the in-memory aggregate, which is a cache of those
 *   rows, rebuilt from them whenever a room opens.
 * - `GameCodesService` owns the ephemeral 6-digit code in Redis, and Redis holds
 *   nothing else about a game.
 * - `GamePresenceService` answers who is connected, straight off the Socket.IO
 *   adapter.
 * - `GameLifecycleService` / `GameLifecycleConsumer` carry every deferred
 *   decision on a queue, so a restart cannot lose them.
 * - `GameTokensService` issues the per-player token that authorises in-game
 *   actions and reconnections.
 * - `GameQrService` renders the join QR on demand. It stores nothing: the symbol
 *   is a pure function of the session uuid and the public origin.
 * - `GameRoomsService` orchestrates all of the above.
 */
@Module({
  imports: [
    MikroOrmModule.forFeature([GameSession, GameParticipant]),
    BullModule.registerQueue({
      name: Constants.GAME_LIFECYCLE_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
      },
    }),
    JwtModule.register({}),
    ConfigModule,
    RedisModule,
    UsersModule,
  ],
  controllers: [GameRuntimeController],
  providers: [
    GameRuntimeService,
    GameRuntimeGateway,
    GameRoomsService,
    GameSessionsService,
    GameCodesService,
    GamePresenceService,
    GameLifecycleService,
    GameLifecycleConsumer,
    GameTokensService,
    GameQrService,
  ],
  exports: [GameRuntimeService, GameRoomsService, GameSessionsService],
})
export class GameCoreModule {}
