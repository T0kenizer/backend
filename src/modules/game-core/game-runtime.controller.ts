import { parseUploadPipe } from '@modules/files/files.pipes';
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
  Put,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { MAX_FILE_SIZE_BYTES } from '@tokenizer/shared/constants/files.constants';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
// Loads the `Express.Multer` global augmentation shipped by @types/multer.
import 'multer';

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

  @Get('modes')
  @ZodSerializerDto(DTOs.ListGameModesResponse)
  public listModes() {
    return this.rooms.listModes();
  }

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

  @Get(':uuid')
  @ZodSerializerDto(DTOs.RetrieveGameSessionResponse)
  public get(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.rooms.ensureRoomOpen(uuid);
  }

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

  @Put(':uuid/participants/current/avatar')
  @Throttle({
    default: {
      limit: Constants.SEAT_AVATAR_LIMIT,
      ttl: Constants.SEAT_AVATAR_TTL_MS,
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }),
  )
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.UpdateSeatResponse)
  public setSeatAvatar(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @UploadedFile(parseUploadPipe()) upload: Express.Multer.File,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.setSeatAvatar(uuid, participantId, upload);
  }

  @Delete(':uuid/participants/current/avatar')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DTOs.UpdateSeatResponse)
  public removeSeatAvatar(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @RawPlayerToken() token: string,
  ) {
    const { participantId } = this.tokens.verify(token, uuid);
    return this.rooms.setSeatAvatar(uuid, participantId, null);
  }

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
