import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import * as DTOs from '@modules/game-core/game-runtime.dtos';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

/**
 * POC REST router for the GameCore runtime. Mirrors the WebSocket gateway's
 * capabilities for out-of-band inspection and scripted testing; live gameplay
 * is expected to run over the socket. Host-only transitions (start, resolve,
 * close) are checked against the logged-in user; seat claiming and actions
 * still carry the POC `externalId` identity so anonymous players can play.
 * Reading room state (the two `GET`s) is public — a guest must see the table
 * before they've claimed a seat, let alone signed in.
 */
@Controller('games')
export class GameRuntimeController {
  constructor(private readonly rooms: GameRoomsService) {}

  @Post()
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(DTOs.CreateGameSessionResponse)
  public create(@Body() data: DTOs.CreateGameSessionData, @Req() req: Request) {
    return this.rooms.createGame(req.user!.uuid, data.config);
  }

  /** Resolves a 6-character join code to its game session (opens the room). */
  @Get('by-code/:joinCode')
  @ZodSerializerDto(DTOs.RetrieveGameSessionResponse)
  public getByJoinCode(@Param('joinCode') joinCode: string) {
    return this.rooms.ensureRoomOpenByJoinCode(joinCode);
  }

  /** Fetching a game lazily (re)opens its room from the persisted session. */
  @Get(':uuid')
  @ZodSerializerDto(DTOs.RetrieveGameSessionResponse)
  public get(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.rooms.ensureRoomOpen(uuid);
  }

  /**
   * Public: seat photos must be viewable by every player in the room, guests
   * included. Serves the data-URL captured live from the camera (no upload
   * endpoint — stored in Redis as part of the room, not the DB).
   */
  @Get(':uuid/participants/:participantId/photo')
  public async getSeatPhoto(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
  ) {
    const dataUrl = await this.rooms.getSeatPhotoByGameId(uuid, participantId);
    if (!dataUrl) throw new NotFoundException('Seat photo not found');

    const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
    if (!match) throw new NotFoundException('Seat photo not found');
    const [, mimeType, base64] = match;

    return new StreamableFile(Buffer.from(base64, 'base64'), {
      type: mimeType,
    });
  }

  @Post(':uuid/participants')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.ClaimSeatResponse)
  public claimSeat(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.ClaimSeatData,
  ) {
    return this.rooms.claimSeat(uuid, data);
  }

  /** Renames/re-photos the seat held by `data.externalId`. */
  @Patch(':uuid/participants/current')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.UpdateSeatResponse)
  public updateSeat(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.UpdateSeatData,
  ) {
    return this.rooms.updateSeat(uuid, data);
  }

  @Post(':uuid/rounds')
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(DTOs.StartRoundResponse)
  public startRound(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Req() req: Request,
  ) {
    return this.rooms.startRound(uuid, req.user!.uuid);
  }

  @Post(':uuid/actions')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.SubmitActionResponse)
  public submitAction(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.SubmitActionData,
  ) {
    return this.rooms.submitAction(uuid, data);
  }

  @Post(':uuid/rounds/current/resolve')
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.ResolveRoundResponse)
  public resolveRound(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.ResolveRoundData,
    @Req() req: Request,
  ) {
    return this.rooms.resolveRound(
      uuid,
      req.user!.uuid,
      data.winnerExternalIds,
    );
  }

  @Delete(':uuid')
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.CloseGameSessionResponse)
  public close(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Req() req: Request,
  ) {
    return this.rooms.closeGame(uuid, req.user!.uuid);
  }
}
