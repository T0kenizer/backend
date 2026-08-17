import { GameParticipant } from '@entities/game/game-participant.entity';
import { GameSession } from '@entities/game/game-session.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import { GameRuntimeController } from '@modules/game-core/game-runtime.controller';
import { GameRuntimeGateway } from '@modules/game-core/game-runtime.gateway';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import { GameSessionsService } from '@modules/game-core/game-sessions.service';
import { RedisModule } from '@modules/redis/redis.module';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';

/**
 * GameCore runtime module. Exposes the in-memory game runtime over both REST
 * (POC router) and WebSocket (live gameplay). `GameSessionsService` owns the
 * persisted `GameSession` CRUD; the runtime aggregate is held in memory by
 * `GameRuntimeService`; `GameRoomsService` maps rooms onto the persisted rows
 * (registry in Redis core), opens them lazily on fetch and closes them after
 * five idle minutes.
 */
@Module({
  imports: [
    MikroOrmModule.forFeature([GameSession, GameParticipant]),
    RedisModule,
    UsersModule,
  ],
  controllers: [GameRuntimeController],
  providers: [
    GameRuntimeService,
    GameRuntimeGateway,
    GameRoomsService,
    GameSessionsService,
  ],
  exports: [GameRuntimeService, GameRoomsService, GameSessionsService],
})
export class GameCoreModule {}
