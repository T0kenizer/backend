import type { MikroORM } from '@mikro-orm/core';
import { ConfigManager } from '@modules/game-core/config-manager';
import * as Constants from '@modules/game-core/game-core.constants';
import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import type { GameSessionsService } from '@modules/game-core/game-sessions.service';
import type { RedisService } from '@modules/redis/services/redis.service';
import type { UsersService } from '@modules/users/users.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// @CreateRequestContext() insists on a real `MikroORM` instance; neuter it so
// the service can run against fakes. The DB work itself is faked below anyway.
jest.mock('@mikro-orm/core', () => ({
  ...jest.requireActual<typeof import('@mikro-orm/core')>('@mikro-orm/core'),
  CreateRequestContext: () => () => undefined,
}));

// Faked in the constructor; mocked here so the import chain does not drag the
// whole files module (and sharp's native bindings) into the test runtime.
jest.mock('@modules/users/users.service', () => ({
  UsersService: class {},
}));

const GAME_UUID = '11111111-1111-4111-8111-111111111111';
const OWNER_UUID = '22222222-2222-4222-8222-222222222222';

/** Minimal in-memory stand-in for the node-redis client surface we use. */
class FakeRedisClient {
  readonly kv = new Map<string, string>();
  readonly hashes = new Map<string, Map<string, string>>();
  readonly sets = new Map<string, Set<string>>();

  hSetNX(key: string, field: string, value: string): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    this.hashes.set(key, hash);
    if (hash.has(field)) return Promise.resolve(0);
    hash.set(field, value);
    return Promise.resolve(1);
  }

  expire(): Promise<boolean> {
    return Promise.resolve(true);
  }

  sAdd(key: string, member: string): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    this.sets.set(key, set);
    set.add(member);
    return Promise.resolve(1);
  }

  sRem(key: string, member: string): Promise<number> {
    return Promise.resolve(this.sets.get(key)?.delete(member) ? 1 : 0);
  }

  sCard(key: string): Promise<number> {
    return Promise.resolve(this.sets.get(key)?.size ?? 0);
  }

  set(key: string, value: string): Promise<string> {
    this.kv.set(key, value);
    return Promise.resolve('OK');
  }

  get(key: string): Promise<Nullable<string>> {
    return Promise.resolve(this.kv.get(key) ?? null);
  }

  del(keys: string | string[]): Promise<number> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      this.kv.delete(key);
      this.hashes.delete(key);
      this.sets.delete(key);
    }
    return Promise.resolve(list.length);
  }
}

function persistedSession(
  overrides: Partial<{ closedAt: Nullable<Date> }> = {},
) {
  return {
    uuid: GAME_UUID,
    closedAt: null as Nullable<Date>,
    config: ConfigManager.fromConfig(defaultGameConfig()),
    ...overrides,
  };
}

describe('GameRoomsService', () => {
  let redis: FakeRedisClient;
  let gameSessions: {
    create: jest.Mock;
    getGameSessionByUuid: jest.Mock;
    close: jest.Mock;
  };
  let users: { getUserByUuid: jest.Mock };
  let runtime: GameRuntimeService;
  let service: GameRoomsService;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = new FakeRedisClient();
    gameSessions = {
      create: jest.fn(),
      getGameSessionByUuid: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Game session not found')),
      close: jest.fn(),
    };
    users = {
      getUserByUuid: jest
        .fn()
        .mockRejectedValue(new NotFoundException('User not found')),
    };
    runtime = new GameRuntimeService();
    service = new GameRoomsService(
      {} as MikroORM,
      gameSessions as unknown as GameSessionsService,
      users as unknown as UsersService,
      { client: redis } as unknown as RedisService,
      runtime,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('lazily opens a room from the persisted session on fetch', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession());

    expect(runtime.hasSession(GAME_UUID)).toBe(false);
    const snapshot = await service.ensureRoomOpen(GAME_UUID);

    expect(snapshot.id).toBe(GAME_UUID);
    expect(runtime.hasSession(GAME_UUID)).toBe(true);
    expect(redis.hashes.get(`game:room:${GAME_UUID}`)?.get('sessionUuid')).toBe(
      GAME_UUID,
    );
  });

  it('closes an empty room after the idle TTL', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession());
    await service.ensureRoomOpen(GAME_UUID);

    await jest.advanceTimersByTimeAsync(Constants.ROOM_IDLE_TTL_MS);

    expect(runtime.hasSession(GAME_UUID)).toBe(false);
    expect(redis.hashes.has(`game:room:${GAME_UUID}`)).toBe(false);
  });

  it('keeps the room open while a socket is bound', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession());
    await service.ensureRoomOpen(GAME_UUID);
    await service.bindSocket(GAME_UUID, 'socket-1', OWNER_UUID);

    await jest.advanceTimersByTimeAsync(Constants.ROOM_IDLE_TTL_MS * 2);

    expect(runtime.hasSession(GAME_UUID)).toBe(true);
  });

  it('re-arms the idle closure when the last socket leaves', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession());
    await service.ensureRoomOpen(GAME_UUID);
    await service.bindSocket(GAME_UUID, 'socket-1', OWNER_UUID);

    const gameId = await service.unbindSocket('socket-1');
    expect(gameId).toBe(GAME_UUID);
    expect(runtime.hasSession(GAME_UUID)).toBe(true);

    await jest.advanceTimersByTimeAsync(Constants.ROOM_IDLE_TTL_MS);
    expect(runtime.hasSession(GAME_UUID)).toBe(false);
    expect(redis.kv.has('game:socket:socket-1')).toBe(false);
  });

  it('rejects fetches for unknown game sessions', async () => {
    await expect(service.ensureRoomOpen(GAME_UUID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('never re-opens a closed game session', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(
      persistedSession({ closedAt: new Date('2026-01-01') }),
    );
    await expect(service.ensureRoomOpen(GAME_UUID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('requires a real user uuid to create a persisted game', async () => {
    await expect(service.createGame('alice')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.createGame(OWNER_UUID)).rejects.toThrow(
      NotFoundException,
    );
    expect(gameSessions.create).not.toHaveBeenCalled();
  });

  it('persists the session then opens its room on creation', async () => {
    users.getUserByUuid.mockResolvedValue({ uuid: OWNER_UUID });
    gameSessions.create.mockResolvedValue(persistedSession());

    const snapshot = await service.createGame(OWNER_UUID);

    expect(gameSessions.create).toHaveBeenCalledTimes(1);
    expect(runtime.hasSession(snapshot.id)).toBe(true);
    expect(redis.hashes.has(`game:room:${snapshot.id}`)).toBe(true);
  });

  it('stamps the persisted row and tears the room down on closeGame', async () => {
    const row = persistedSession();
    gameSessions.getGameSessionByUuid.mockResolvedValue(row);
    await service.ensureRoomOpen(GAME_UUID);

    const snapshot = await service.closeGame(GAME_UUID);

    expect(snapshot.status).toBe('FINISHED');
    expect(gameSessions.close).toHaveBeenCalledWith(row);
    expect(runtime.hasSession(GAME_UUID)).toBe(false);
    expect(redis.hashes.has(`game:room:${GAME_UUID}`)).toBe(false);
  });
});
