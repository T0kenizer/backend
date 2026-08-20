import type { GameParticipant } from '@entities/game/game-participant.entity';
import { CreateRequestContext, MikroORM } from '@mikro-orm/core';
import * as Constants from '@modules/game-core/game-core.constants';
import type {
  SeatInit,
  SocketBinding,
} from '@modules/game-core/game-core.types';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import type {
  RawParticipantSnapshot,
  RuntimeSnapshot,
} from '@modules/game-core/game-runtime.snapshot';
import { GameSessionsService } from '@modules/game-core/game-sessions.service';
import { RedisService } from '@modules/redis/services/redis.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  buildFileUrl,
  buildSeatPhotoUrl,
  gameConfigSchema,
} from '@tokenizer/shared/schemas';
import type {
  ClaimSeatData,
  GameConfig,
  GameSnapshot,
  ParticipantSnapshot,
  RoundResolution,
  SubmitActionData,
  UpdateSeatData,
} from '@tokenizer/shared/types';
import { z } from 'zod';

/** Redis: set of socket ids currently connected to a room. */
function roomSocketsKey(joinCode: string): string {
  return `game:room:${joinCode}:sockets`;
}

/** Redis: reverse map from a socket id to its game session. */
function socketKey(socketId: string): string {
  return `game:socket:${socketId}`;
}

/** Redis: seat photo override, a data-URL string (no upload endpoint — POC). */
function seatPhotoKey(joinCode: string, participantId: string): string {
  return `game:room:${joinCode}:photo:${participantId}`;
}

/**
 * Orchestrates the ephemeral game rooms sitting on top of the persisted
 * `GameSession` rows: the runtime aggregate and the DB row share the session
 * uuid, while the Socket.IO room and Redis occupancy are keyed by the room's
 * short `joinCode` instead — every gameplay transition that settles chips is
 * written back to the rows.
 *
 * Rooms open lazily: fetching a game whose room is closed hydrates the runtime
 * aggregate (config + seats + balances) from the database. A room that stays
 * empty (no connected socket) for {@link Constants.ROOM_IDLE_TTL_MS} is torn
 * down; the persisted session survives and the room re-opens on the next
 * fetch.
 */
@Injectable()
export class GameRoomsService implements OnModuleDestroy {
  private readonly logger = new Logger(GameRoomsService.name);
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  // `orm` backs @CreateRequestContext(): entry points outside the HTTP
  // request scope (WebSocket gateway, idle timers) get a fresh DB context.
  constructor(
    private readonly orm: MikroORM,
    private readonly gameSessionsService: GameSessionsService,
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
    private readonly runtime: GameRuntimeService,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
  }

  /** Persists a new `GameSession` and its seats, then opens its room. */
  @CreateRequestContext()
  async createGame(
    ownerUuid: string,
    config?: GameConfig,
  ): Promise<GameSnapshot> {
    if (!z.uuid().safeParse(ownerUuid).success) {
      throw new BadRequestException(
        'Creating a game requires an authenticated user uuid as externalId',
      );
    }

    const owner = await this.usersService.getUserByUuid(ownerUuid);
    const gameConfig = config ?? defaultGameConfig();
    const { session, participants } = await this.gameSessionsService.create(
      owner,
      gameConfig,
    );

    const snapshot = this.runtime.registerSession(
      session.uuid,
      gameConfig,
      owner.uuid,
      await this.seatInits(session.joinCode, participants),
    );
    this.armIdleClose(session.joinCode);
    return this.finalize(snapshot, session.joinCode, gameConfig);
  }

  /** Resolves a join code to its session, then opens the room the same way. */
  @CreateRequestContext()
  async ensureRoomOpenByJoinCode(joinCode: string): Promise<GameSnapshot> {
    const session =
      await this.gameSessionsService.getGameSessionByJoinCode(joinCode);
    return this.ensureRoomOpen(session.uuid);
  }

  /**
   * Resolves a join code to its session uuid. Wrapped in a request context so
   * WebSocket callers (outside the HTTP request scope) can use it safely.
   */
  @CreateRequestContext()
  async resolveGameId(joinCode: string): Promise<string> {
    const session =
      await this.gameSessionsService.getGameSessionByJoinCode(joinCode);
    return session.uuid;
  }

  /**
   * Opens the room if it is not already open, hydrating the runtime aggregate
   * (config, seats, claims, balances) from the persisted session. Fetching a
   * game is enough to (re)open its room; the idle countdown starts immediately
   * when no socket is connected.
   */
  @CreateRequestContext()
  async ensureRoomOpen(gameId: string): Promise<GameSnapshot> {
    const session = await this.gameSessionsService.getGameSessionByUuid(gameId);
    // Stored JSON is re-validated on its way back into the runtime.
    const config = gameConfigSchema.parse(session.config);
    if (!this.runtime.hasSession(gameId)) {
      if (session.closedAt) {
        throw new BadRequestException(`Game session ${gameId} is closed`);
      }
      this.runtime.registerSession(
        session.uuid,
        config,
        session.owner.uuid,
        await this.seatInits(session.joinCode, session.participants.getItems()),
      );
      this.logger.log(`Room ${session.joinCode} opened from persisted session`);
    }
    await this.armIdleCloseIfEmpty(session.joinCode, gameId);
    const snapshot = this.runtime.snapshot(gameId);
    return this.finalize(snapshot, session.joinCode, config);
  }

  /** Claims a seat in the runtime, then stamps the persisted row. */
  @CreateRequestContext()
  async claimSeat(gameId: string, data: ClaimSeatData): Promise<GameSnapshot> {
    await this.ensureRoomOpen(gameId);
    const { snapshot, participantId } = this.runtime.claimSeat(gameId, {
      externalId: data.externalId,
      displayName: data.displayName,
      hasPhoto: data.photo !== undefined,
      seatIndex: data.seatIndex,
    });

    const session = await this.gameSessionsService.getGameSessionByUuid(gameId);
    const row = session.participants
      .getItems()
      .find((p) => p.uuid === participantId);
    // Idempotent re-claims keep the original stamp.
    if (row && !row.claimedBy) {
      await this.gameSessionsService.claim(
        row,
        data.externalId,
        data.displayName,
      );
    }
    if (data.photo !== undefined) {
      await this.storeSeatPhoto(session.joinCode, participantId, data.photo);
    }
    const config = gameConfigSchema.parse(session.config);
    return this.finalize(snapshot, session.joinCode, config);
  }

  /** Renames/re-photos the caller's own seat; persists the change. */
  @CreateRequestContext()
  async updateSeat(
    gameId: string,
    data: UpdateSeatData,
  ): Promise<GameSnapshot> {
    const opened = await this.ensureRoomOpen(gameId);
    const { snapshot, participantId } = this.runtime.updateSeat(gameId, {
      externalId: data.externalId,
      displayName: data.displayName,
      hasPhoto: data.photo === undefined ? undefined : data.photo !== null,
    });

    const session = await this.gameSessionsService.getGameSessionByUuid(gameId);
    const row = session.participants
      .getItems()
      .find((p) => p.uuid === participantId);
    if (row) {
      await this.gameSessionsService.updateSeat(row, data.displayName);
    }
    if (data.photo !== undefined) {
      if (data.photo === null) {
        await this.clearSeatPhoto(opened.joinCode, participantId);
      } else {
        await this.storeSeatPhoto(opened.joinCode, participantId, data.photo);
      }
    }
    const config = gameConfigSchema.parse(session.config);
    return this.finalize(snapshot, opened.joinCode, config);
  }

  /** Host-only: starts a round (pure runtime transition, nothing to persist). */
  @CreateRequestContext()
  async startRound(gameId: string, externalId: string): Promise<GameSnapshot> {
    const opened = await this.ensureRoomOpen(gameId);
    this.assertHost(gameId, externalId);
    const snapshot = this.runtime.startRound(gameId);
    return this.finalizeFromOpened(snapshot, gameId, opened);
  }

  /** Applies an action; when it settles the round, balances are persisted. */
  @CreateRequestContext()
  async submitAction(
    gameId: string,
    data: SubmitActionData,
  ): Promise<{ snapshot: GameSnapshot; resolution?: RoundResolution }> {
    const opened = await this.ensureRoomOpen(gameId);
    const result = this.runtime.submitAction(gameId, data);
    if (result.resolution) await this.persistBalances(gameId);
    return {
      ...result,
      snapshot: await this.finalizeFromOpened(result.snapshot, gameId, opened),
    };
  }

  /** Host-only: manual round resolution; balances are persisted. */
  @CreateRequestContext()
  async resolveRound(
    gameId: string,
    externalId: string,
    winnerExternalIds?: string[],
  ): Promise<{ snapshot: GameSnapshot; resolution: RoundResolution }> {
    const opened = await this.ensureRoomOpen(gameId);
    this.assertHost(gameId, externalId);
    const result = this.runtime.resolveRound(gameId, winnerExternalIds);
    await this.persistBalances(gameId);
    return {
      ...result,
      snapshot: await this.finalizeFromOpened(result.snapshot, gameId, opened),
    };
  }

  /**
   * Host-only termination: finishes the runtime session, persists the final
   * balances, stamps the DB row (`closedAt`) so the room can never re-open,
   * then tears the room down.
   */
  @CreateRequestContext()
  async closeGame(gameId: string, externalId: string): Promise<GameSnapshot> {
    const opened = await this.ensureRoomOpen(gameId);
    this.assertHost(gameId, externalId);
    const snapshot = this.runtime.closeSession(gameId);

    const session = await this.gameSessionsService.getGameSessionByUuid(gameId);
    const balances = new Map(
      snapshot.participants.map((p) => [p.id, p.balance]),
    );
    await this.gameSessionsService.syncBalances(session, balances);
    await this.gameSessionsService.close(session);

    await this.closeRoom(opened.joinCode, gameId);
    return this.finalizeFromOpened(snapshot, gameId, opened);
  }

  /** Attaches a socket to a room and cancels any pending idle closure. */
  async bindSocket(
    joinCode: string,
    socketId: string,
    externalId: string,
  ): Promise<void> {
    this.cancelIdleClose(joinCode);
    const binding: SocketBinding = { joinCode, externalId };
    await this.redisService.client
      .multi()
      .sAdd(roomSocketsKey(joinCode), socketId)
      .expire(roomSocketsKey(joinCode), Constants.REGISTRY_TTL_SECONDS)
      .set(socketKey(socketId), JSON.stringify(binding), {
        EX: Constants.REGISTRY_TTL_SECONDS,
      })
      .exec();
  }

  /**
   * Detaches a socket (typically on disconnect). When the room ends up empty
   * the idle countdown starts. Returns the join code the socket was bound to.
   */
  async unbindSocket(socketId: string): Promise<Nullable<string>> {
    const client = this.redisService.client;
    const raw = await client.get(socketKey(socketId));
    if (!raw) return null;

    const { joinCode } = JSON.parse(raw) as SocketBinding;
    await client
      .multi()
      .del(socketKey(socketId))
      .sRem(roomSocketsKey(joinCode), socketId)
      .exec();

    if ((await this.occupancy(joinCode)) === 0) {
      this.scheduleIdleClose(joinCode);
    }

    return joinCode;
  }

  /** Tears down the room only: runtime aggregate and Redis occupancy. */
  async closeRoom(joinCode: string, gameId: string): Promise<void> {
    this.cancelIdleClose(joinCode);
    this.runtime.disposeSession(gameId);
    await this.redisService.client.del(roomSocketsKey(joinCode));
    this.logger.log(`Room ${joinCode} closed`);
  }

  /** Number of sockets currently connected to the room. */
  async occupancy(joinCode: string): Promise<number> {
    return this.redisService.client.sCard(roomSocketsKey(joinCode));
  }

  /** Rejects callers that do not occupy the host seat. */
  private assertHost(gameId: string, externalId: string): void {
    if (!this.runtime.isHost(gameId, externalId)) {
      throw new ForbiddenException('Only the host can perform this action');
    }
  }

  private async seatInits(
    joinCode: string,
    rows: GameParticipant[],
  ): Promise<SeatInit[]> {
    const photoKeys = rows.map((p) => seatPhotoKey(joinCode, p.uuid));
    // The photo override itself lives in Redis (not the DB row), so
    // rehydrating a room checks which seats still have one on file.
    const photos = rows.length
      ? await this.redisService.client.mGet(photoKeys)
      : [];

    return rows.map((p, index) => ({
      id: p.uuid,
      seatIndex: p.seatIndex,
      role: p.role,
      displayNameOverride: p.displayName,
      hasPhotoOverride: photos[index] != null,
      balance: p.balance,
      controller: p.claimedBy,
    }));
  }

  /**
   * Resolves `displayName`/`photoUrl` for every participant: an explicit
   * override wins, else the claiming account's own name/avatar (when
   * `controller` is a real user uuid), else the config's default seat name (no
   * config fallback for photos — an account-less/anonymous seat with no
   * override just has none).
   */
  private async finalize(
    snapshot: RuntimeSnapshot,
    joinCode: string,
    config: GameConfig,
  ): Promise<GameSnapshot> {
    const participants = await Promise.all(
      snapshot.participants.map((p) =>
        this.resolveParticipant(snapshot.id, p, config),
      ),
    );
    return { ...snapshot, joinCode, participants };
  }

  /** Same as {@link finalize}, reusing the config already fetched for `opened`. */
  private async finalizeFromOpened(
    snapshot: RuntimeSnapshot,
    gameId: string,
    opened: GameSnapshot,
  ): Promise<GameSnapshot> {
    const session = await this.gameSessionsService.getGameSessionByUuid(gameId);
    const config = gameConfigSchema.parse(session.config);
    return this.finalize(snapshot, opened.joinCode, config);
  }

  private async resolveParticipant(
    gameId: string,
    p: RawParticipantSnapshot,
    config: GameConfig,
  ): Promise<ParticipantSnapshot> {
    const account = p.controller
      ? await this.usersService.findUserByUuid(p.controller)
      : null;

    const displayName =
      p.displayNameOverride ??
      account?.displayName ??
      account?.username ??
      config.seating.seats[p.seatIndex]?.displayName ??
      `Seat ${p.seatIndex + 1}`;

    let photoUrl: Nullable<string> = null;
    if (p.hasPhotoOverride) {
      photoUrl = buildSeatPhotoUrl(gameId, p.id);
    } else if (account?.avatar) {
      photoUrl = buildFileUrl(account.avatar.uuid);
    }

    return {
      id: p.id,
      role: p.role,
      balance: p.balance,
      seatIndex: p.seatIndex,
      status: p.status,
      controller: p.controller,
      displayName,
      photoUrl,
    };
  }

  /** Persists a seat photo override in Redis (no upload endpoint — POC). */
  private async storeSeatPhoto(
    joinCode: string,
    participantId: string,
    photo: string,
  ): Promise<void> {
    await this.redisService.client.set(
      seatPhotoKey(joinCode, participantId),
      photo,
      { EX: Constants.REGISTRY_TTL_SECONDS },
    );
  }

  private async clearSeatPhoto(
    joinCode: string,
    participantId: string,
  ): Promise<void> {
    await this.redisService.client.del(seatPhotoKey(joinCode, participantId));
  }

  /** Raw data-URL string stored for a seat's photo override, if any. */
  @CreateRequestContext()
  async getSeatPhotoByGameId(
    gameId: string,
    participantId: string,
  ): Promise<Nullable<string>> {
    const session = await this.gameSessionsService.getGameSessionByUuid(gameId);
    return this.redisService.client.get(
      seatPhotoKey(session.joinCode, participantId),
    );
  }

  private async persistBalances(gameId: string): Promise<void> {
    const snapshot = this.runtime.snapshot(gameId);
    const session = await this.gameSessionsService.getGameSessionByUuid(gameId);
    const balances = new Map(
      snapshot.participants.map((p) => [p.id, p.balance]),
    );
    await this.gameSessionsService.syncBalances(session, balances);
  }

  /** A freshly opened room with nobody connected starts its idle countdown. */
  private armIdleClose(joinCode: string): void {
    this.scheduleIdleClose(joinCode);
  }

  private async armIdleCloseIfEmpty(
    joinCode: string,
    gameId: string,
  ): Promise<void> {
    if ((await this.occupancy(joinCode)) === 0) {
      this.scheduleIdleClose(joinCode, gameId);
    }
  }

  private scheduleIdleClose(joinCode: string, gameId?: string): void {
    this.cancelIdleClose(joinCode);
    const timer = setTimeout(() => {
      void this.closeIfStillEmpty(joinCode, gameId);
    }, Constants.ROOM_IDLE_TTL_MS);
    // Idle-room bookkeeping must not hold the process open on shutdown.
    timer.unref?.();
    this.idleTimers.set(joinCode, timer);
  }

  private cancelIdleClose(joinCode: string): void {
    const timer = this.idleTimers.get(joinCode);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(joinCode);
    }
  }

  private async closeIfStillEmpty(
    joinCode: string,
    gameId?: string,
  ): Promise<void> {
    this.idleTimers.delete(joinCode);
    try {
      // A socket may have joined while the timer was in flight.
      if ((await this.occupancy(joinCode)) > 0) return;
      const resolvedGameId =
        gameId ??
        (await this.gameSessionsService.getGameSessionByJoinCode(joinCode))
          .uuid;
      await this.closeRoom(joinCode, resolvedGameId);
      this.logger.log(
        `Room ${joinCode} closed after ${Constants.ROOM_IDLE_TTL_MS / 60_000} minutes without players`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to close idle room ${joinCode}: ${message}`);
    }
  }
}
