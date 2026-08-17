import { CreateRequestContext, MikroORM } from '@mikro-orm/core';
import * as Constants from '@modules/game-core/game-core.constants';
import type {
  GameSessionId,
  SocketBinding,
} from '@modules/game-core/game-core.types';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import { GameSessionsService } from '@modules/game-core/game-sessions.service';
import { RedisService } from '@modules/redis/services/redis.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { GameConfig, GameSnapshot } from '@tokenizer/shared/types';

/** Redis: room registry entry, keyed by the DB `GameSession` uuid. */
function roomKey(gameId: GameSessionId): string {
  return `game:room:${gameId}`;
}

/** Redis: set of socket ids currently connected to a room. */
function roomSocketsKey(gameId: GameSessionId): string {
  return `game:room:${gameId}:sockets`;
}

/** Redis: reverse map from a socket id to its game session. */
function socketKey(socketId: string): string {
  return `game:socket:${socketId}`;
}

/**
 * Lifecycle of the ephemeral game rooms sitting on top of the persisted
 * `GameSession` rows. A room shares its id with the DB uuid; the mapping (room
 * registry, room occupancy, socket → session) lives in Redis core.
 *
 * Rooms open lazily: fetching a game whose room is closed hydrates the runtime
 * aggregate from the DB row. A room that stays empty (no connected socket) for
 * {@link Constants.ROOM_IDLE_TTL_MS} is torn down; the persisted session
 * survives and the room can re-open on the next fetch.
 */
@Injectable()
export class GameRoomsService implements OnModuleDestroy {
  private readonly logger = new Logger(GameRoomsService.name);
  private readonly idleTimers = new Map<GameSessionId, NodeJS.Timeout>();

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

  /** Persists a new `GameSession` row, then opens its room. */
  @CreateRequestContext()
  async createGame(
    ownerUuid: string,
    config?: GameConfig,
  ): Promise<GameSnapshot> {
    if (!Constants.UUID_PATTERN.test(ownerUuid)) {
      throw new BadRequestException(
        'Creating a game requires an authenticated user uuid as externalId',
      );
    }

    const owner = await this.usersService.getUserByUuid(ownerUuid);
    const gameConfig = config ?? defaultGameConfig();
    const session = await this.gameSessionsService.create(owner, gameConfig);

    const snapshot = this.runtime.registerSession(session.uuid, gameConfig);
    await this.openRoom(session.uuid);
    return snapshot;
  }

  /**
   * Opens the room if it is not already open, hydrating the runtime aggregate
   * from the persisted session. Fetching a game is enough to (re)open its room;
   * the idle countdown starts immediately when no socket is connected.
   */
  @CreateRequestContext()
  async ensureRoomOpen(gameId: GameSessionId): Promise<GameSnapshot> {
    if (!this.runtime.hasSession(gameId)) {
      const session =
        await this.gameSessionsService.getGameSessionByUuid(gameId);
      if (session.closedAt) {
        throw new BadRequestException(`Game session ${gameId} is closed`);
      }
      this.runtime.registerSession(session.uuid, session.config.config);
      this.logger.log(`Room ${gameId} opened from persisted session`);
    }
    await this.openRoom(gameId);
    return this.runtime.snapshot(gameId);
  }

  /** Attaches a socket to a room and cancels any pending idle closure. */
  async bindSocket(
    gameId: GameSessionId,
    socketId: string,
    externalId: string,
  ): Promise<void> {
    this.cancelIdleClose(gameId);
    const client = this.redisService.client;
    const binding: SocketBinding = { gameId, externalId };
    await client.sAdd(roomSocketsKey(gameId), socketId);
    await client.expire(roomSocketsKey(gameId), Constants.REGISTRY_TTL_SECONDS);
    await client.set(socketKey(socketId), JSON.stringify(binding), {
      EX: Constants.REGISTRY_TTL_SECONDS,
    });
  }

  /**
   * Detaches a socket (typically on disconnect). When the room ends up empty
   * the idle countdown starts. Returns the game the socket was bound to.
   */
  async unbindSocket(socketId: string): Promise<Nullable<GameSessionId>> {
    const client = this.redisService.client;
    const raw = await client.get(socketKey(socketId));
    if (!raw) return null;

    const { gameId } = JSON.parse(raw) as SocketBinding;
    await client.del(socketKey(socketId));
    await client.sRem(roomSocketsKey(gameId), socketId);

    if (this.runtime.hasSession(gameId) && (await this.occupancy(gameId)) === 0)
      this.scheduleIdleClose(gameId);

    return gameId;
  }

  /**
   * User-driven termination: finishes the runtime session, stamps the DB row
   * (`closedAt`) so the room can never re-open, then tears the room down.
   */
  @CreateRequestContext()
  async closeGame(gameId: GameSessionId): Promise<GameSnapshot> {
    const snapshot = this.runtime.closeSession(gameId);

    const session = await this.gameSessionsService.getGameSessionByUuid(gameId);
    await this.gameSessionsService.close(session);

    await this.closeRoom(gameId);
    return snapshot;
  }

  /** Tears down the room only: runtime aggregate and Redis registry entries. */
  async closeRoom(gameId: GameSessionId): Promise<void> {
    this.cancelIdleClose(gameId);
    this.runtime.disposeSession(gameId);
    await this.redisService.client.del([
      roomKey(gameId),
      roomSocketsKey(gameId),
    ]);
    this.logger.log(`Room ${gameId} closed`);
  }

  /** Number of sockets currently connected to the room. */
  async occupancy(gameId: GameSessionId): Promise<number> {
    return this.redisService.client.sCard(roomSocketsKey(gameId));
  }

  /** Writes the room registry entry and (re)arms the idle timer if empty. */
  private async openRoom(gameId: GameSessionId): Promise<void> {
    const client = this.redisService.client;
    const key = roomKey(gameId);
    await client.hSetNX(key, 'sessionUuid', gameId);
    await client.hSetNX(key, 'openedAt', new Date().toISOString());
    await client.expire(key, Constants.REGISTRY_TTL_SECONDS);

    if ((await this.occupancy(gameId)) === 0) this.scheduleIdleClose(gameId);
  }

  private scheduleIdleClose(gameId: GameSessionId): void {
    this.cancelIdleClose(gameId);
    const timer = setTimeout(() => {
      void this.closeIfStillEmpty(gameId);
    }, Constants.ROOM_IDLE_TTL_MS);
    // Idle-room bookkeeping must not hold the process open on shutdown.
    timer.unref?.();
    this.idleTimers.set(gameId, timer);
  }

  private cancelIdleClose(gameId: GameSessionId): void {
    const timer = this.idleTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(gameId);
    }
  }

  private async closeIfStillEmpty(gameId: GameSessionId): Promise<void> {
    this.idleTimers.delete(gameId);
    try {
      // A socket may have joined while the timer was in flight.
      if ((await this.occupancy(gameId)) > 0) return;
      await this.closeRoom(gameId);
      this.logger.log(
        `Room ${gameId} closed after ${Constants.ROOM_IDLE_TTL_MS / 60_000} minutes without players`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to close idle room ${gameId}: ${message}`);
    }
  }
}
