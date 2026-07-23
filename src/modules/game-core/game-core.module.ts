import { GameRuntimeController } from '@modules/game-core/game-runtime.controller';
import { GameRuntimeGateway } from '@modules/game-core/game-runtime.gateway';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import { Module } from '@nestjs/common';

/**
 * GameCore runtime module. Exposes the in-memory game runtime over both REST
 * (POC router) and WebSocket (live gameplay). The runtime aggregate is held in
 * memory by `GameRuntimeService`; database persistence will be layered on
 * later.
 */
@Module({
  controllers: [GameRuntimeController],
  providers: [GameRuntimeService, GameRuntimeGateway],
  exports: [GameRuntimeService],
})
export class GameCoreModule {}
