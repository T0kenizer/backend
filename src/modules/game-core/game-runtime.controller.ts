import * as Constants from '@modules/game-core/game-core.constants';
import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import * as DTOs from '@modules/game-core/game-runtime.dtos';
import { GameTokensService } from '@modules/game-core/game-tokens.service';
import { RawPlayerToken } from '@modules/game-core/player-token.decorator';
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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

/**
 * REST router for the game runtime.
 *
 * This is where identity is established. Creating a game and taking a seat go
 * through here because both need the session cookie, and both answer with the
 * player token that the socket then replays — live gameplay runs over the
 * socket, but it never mints identity of its own.
 *
 * The two code-facing routes are rate-limited well below the global default. A
 * 6-digit code is a 10^6 space: left open, either route is an enumeration
 * oracle, and the cheaper one would map out every live room in minutes.
 */
@Controller('games')
export class GameRuntimeController {
  constructor(
    private readonly rooms: GameRoomsService,
    private readonly tokens: GameTokensService,
  ) {}

  @Post()
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(DTOs.CreateGameSessionResponse)
  public create(@Body() data: DTOs.CreateGameSessionData, @Req() req: Request) {
    return this.rooms.createGame(req.user!.uuid, data.config, data.name);
  }

  /**
   * Resolves a dictated code to the session uuid behind it — the one and only
   * thing a code is for. Everything afterwards is keyed by that uuid.
   *
   * A code that never existed and one that has expired get the same 404, with
   * the same body. Telling them apart would confirm which codes were ever
   * issued, which is exactly what an enumerator is after.
   */
  @Post('join-by-code')
  @Throttle({
    default: {
      limit: Constants.JOIN_BY_CODE_LIMIT,
      ttl: Constants.JOIN_BY_CODE_TTL_MS,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.JoinByCodeResponse)
  public async joinByCode(@Body() data: DTOs.JoinByCodeData) {
    const gameUuid = await this.rooms.resolveCode(data.code);
    if (!gameUuid) throw new NotFoundException('Invalid or expired code');

    return { gameUuid };
  }

  /**
   * The public view behind a code: what the game is called, whether it is still
   * open, how full it is. Never a player's data, and never the uuid — seeing a
   * room and being let into it are two different privileges.
   */
  @Get('room-by-code/:code')
  @Throttle({
    default: {
      limit: Constants.ROOM_BY_CODE_LIMIT,
      ttl: Constants.ROOM_BY_CODE_TTL_MS,
    },
  })
  @ZodSerializerDto(DTOs.RetrieveRoomByCodeResponse)
  public async getRoomByCode(@Param('code') code: string) {
    const gameUuid = await this.rooms.resolveCode(code);
    if (!gameUuid) throw new NotFoundException('Invalid or expired code');

    return this.rooms.publicRoomView(gameUuid);
  }

  /** Fetching a game (re)opens its room from the persisted session. */
  @Get(':uuid')
  @ZodSerializerDto(DTOs.RetrieveGameSessionResponse)
  public get(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.rooms.ensureRoomOpen(uuid);
  }

  /**
   * Takes a seat and issues the player token.
   *
   * Open to guests on purpose — an anonymous player must be able to sit down.
   * When the caller is signed in, their uuid becomes the seat's holder, so they
   * find the same seat again on any device; a returning player instead presents
   * the token they were issued.
   */
  @Post(':uuid/participants')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.ClaimSeatResponse)
  public joinGame(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.ClaimSeatData,
    @Req() req: Request,
  ) {
    return this.rooms.joinGame(uuid, data, req.user?.uuid);
  }

  /** Renames the seat the token belongs to. */
  @Patch(':uuid/participants/current')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.UpdateSeatResponse)
  public updateSeat(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.UpdateSeatData,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.updateSeat(uuid, participantId, data);
  }

  @Post(':uuid/rounds')
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(DTOs.StartRoundResponse)
  public startRound(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.startRound(uuid, participantId);
  }

  @Post(':uuid/actions')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.SubmitActionResponse)
  public submitAction(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.SubmitActionData,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.submitAction(uuid, participantId, data);
  }

  @Post(':uuid/rounds/current/resolve')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.ResolveRoundResponse)
  public resolveRound(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.ResolveRoundData,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.resolveRound(
      uuid,
      participantId,
      data.winnerParticipantIds,
    );
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.CloseGameSessionResponse)
  public close(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.closeGame(uuid, participantId);
  }
}
