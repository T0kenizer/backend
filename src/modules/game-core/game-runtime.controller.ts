import * as Constants from '@modules/game-core/game-core.constants';
import { GameQrService } from '@modules/game-core/game-qr.service';
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
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
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
    private readonly qr: GameQrService,
  ) {}

  @Post()
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(DTOs.CreateGameSessionResponse)
  public create(@Body() data: DTOs.CreateGameSessionData, @Req() req: Request) {
    return this.rooms.createGame(req.user!.uuid, data);
  }

  /**
   * The games a host may open a table in, with the parameters each one starts
   * from. Public — browsing them takes no more trust than seeing a pricing page
   * — so it works before sign-in too.
   */
  @Get('modes')
  @ZodSerializerDto(DTOs.ListGameModesResponse)
  public listModes() {
    return this.rooms.listModes();
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
   * The room's join QR, rendered on demand.
   *
   * Served like a file's content rather than as JSON: it is an image behind a
   * uuid, so clients point an `<img>` at it and the browser does the caching.
   * The symbol encodes the join link, which is keyed by that same uuid and
   * therefore never changes — hence the immutable year, and the ETag that lets
   * a revalidation cost 304 bytes instead of a re-render.
   *
   * The session is looked up first so an unknown uuid 404s rather than handing
   * back a perfectly scannable QR for a room that does not exist.
   */
  @Get(':uuid/qrcode')
  public async getQrCode(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Headers('if-none-match') ifNoneMatch: Optional<string>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Optional<StreamableFile>> {
    await this.rooms.publicRoomView(uuid);
    const { png, etag } = await this.qr.render(uuid);

    res.setHeader(
      'Cache-Control',
      `public, max-age=${Constants.JOIN_QR_MAX_AGE_SECONDS}, immutable`,
    );
    res.setHeader('ETag', etag);

    if (ifNoneMatch === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return;
    }

    return new StreamableFile(png, {
      type: 'image/png',
      length: png.length,
      disposition: `inline; filename="tokenizer-${uuid}.png"`,
    });
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

  /** Host only: deals the next hand. */
  @Post(':uuid/hands')
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(DTOs.StartHandResponse)
  public startHand(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.startHand(uuid, participantId);
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

  /**
   * Host only: settles a showdown. The cards are on the physical table and the
   * app never sees them, so the winner is declared rather than computed — which
   * is also why this is a separate call and not a flag on an action.
   */
  @Post(':uuid/hands/current/showdown')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.DeclareWinnersResponse)
  public declareWinners(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.DeclareWinnersData,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.declareWinners(uuid, participantId, data.awards);
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
