import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import * as DTOs from '@modules/game-core/game-runtime.dtos';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

/**
 * POC REST router for the GameCore runtime. Mirrors the WebSocket gateway's
 * capabilities for out-of-band inspection and scripted testing; live gameplay
 * is expected to run over the socket. Session CRUD follows the authenticated
 * conventions (owner is the logged-in user); gameplay routes still carry the
 * POC `externalId` identity.
 */
@Controller('games')
@UseGuards(AuthenticatedGuard)
export class GameRuntimeController {
  constructor(
    private readonly runtime: GameRuntimeService,
    private readonly rooms: GameRoomsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(DTOs.CreateGameSessionResponse)
  public create(@Body() data: DTOs.CreateGameSessionData, @Req() req: Request) {
    return this.rooms.createGame(req.user!.uuid, data.config);
  }

  /** Fetching a game lazily (re)opens its room from the persisted session. */
  @Get(':uuid')
  @ZodSerializerDto(DTOs.RetrieveGameSessionResponse)
  public get(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.rooms.ensureRoomOpen(uuid);
  }

  @Post(':uuid/participants')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.JoinGameSessionResponse)
  public async join(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.JoinGameSessionData,
  ) {
    await this.rooms.ensureRoomOpen(uuid);
    return this.runtime.join(uuid, data);
  }

  @Post(':uuid/rounds')
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(DTOs.StartRoundResponse)
  public startRound(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.runtime.startRound(uuid);
  }

  @Post(':uuid/actions')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.SubmitActionResponse)
  public submitAction(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.SubmitActionData,
  ) {
    return this.runtime.submitAction(uuid, data);
  }

  @Post(':uuid/rounds/current/resolve')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.ResolveRoundResponse)
  public resolveRound(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.ResolveRoundData,
  ) {
    return this.runtime.resolveRound(uuid, data.winnerExternalIds);
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.CloseGameSessionResponse)
  public close(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.rooms.closeGame(uuid);
  }
}
