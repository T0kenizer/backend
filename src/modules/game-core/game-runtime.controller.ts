import type { GameConfig } from '@modules/game-core/config/game-config';
import * as DTOs from '@modules/game-core/game-runtime.dtos';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';

/**
 * POC REST router for the GameCore runtime. Mirrors the WebSocket gateway's
 * capabilities for out-of-band inspection and scripted testing; live gameplay
 * is expected to run over the socket. Assumes the caller is already
 * authenticated (identity is carried by `externalId` in this POC).
 */
@Controller('games')
export class GameRuntimeController {
  constructor(private readonly runtime: GameRuntimeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public create(@Body() data: DTOs.CreateGameData) {
    return this.runtime.createSession(data.config as GameConfig | undefined);
  }

  @Get(':id')
  public get(@Param('id') id: string) {
    return this.runtime.snapshot(id);
  }

  @Post(':id/participants')
  @HttpCode(HttpStatus.OK)
  public join(@Param('id') id: string, @Body() data: DTOs.JoinGameData) {
    return this.runtime.join(id, data);
  }

  @Post(':id/rounds')
  @HttpCode(HttpStatus.CREATED)
  public startRound(@Param('id') id: string) {
    return this.runtime.startRound(id);
  }

  @Post(':id/actions')
  @HttpCode(HttpStatus.OK)
  public submitAction(
    @Param('id') id: string,
    @Body() data: DTOs.SubmitActionData,
  ) {
    return this.runtime.submitAction(id, data);
  }

  @Post(':id/rounds/current/resolve')
  @HttpCode(HttpStatus.OK)
  public resolveRound(
    @Param('id') id: string,
    @Body() data: DTOs.ResolveRoundData,
  ) {
    return this.runtime.resolveRound(id, data.winnerExternalIds);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  public close(@Param('id') id: string) {
    return this.runtime.closeSession(id);
  }
}
