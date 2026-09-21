import type { GameParticipant } from '@entities/game/game-participant.entity';
import type { MikroORM } from '@mikro-orm/core';
import * as Constants from '@modules/game-core/game-core.constants';
import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import type { GameSessionsService } from '@modules/game-core/game-sessions.service';
import type { RedisService } from '@modules/redis/services/redis.service';
import type { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ParticipantRole } from '@tokenizer/shared/types';

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
const JOIN_CODE = 'ABC123';

/** Minimal in-memory stand-in for the node-redis client surface we use. */
class FakeRedisClient {
  readonly kv = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();

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

  expire(): Promise<boolean> {
    return Promise.resolve(true);
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
      this.sets.delete(key);
    }
    return Promise.resolve(list.length);
  }

  mGet(keys: string[]): Promise<Nullable<string>[]> {
    return Promise.resolve(keys.map((key) => this.kv.get(key) ?? null));
  }

  /** Queued command chain, applied on exec — enough for our multi() usage. */
  multi() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain = {
      sAdd: (key: string, member: string) => {
        ops.push(() => this.sAdd(key, member));
        return chain;
      },
      sRem: (key: string, member: string) => {
        ops.push(() => this.sRem(key, member));
        return chain;
      },
      expire: () => {
        ops.push(() => this.expire());
        return chain;
      },
      set: (key: string, value: string) => {
        ops.push(() => this.set(key, value));
        return chain;
      },
      del: (keys: string | string[]) => {
        ops.push(() => this.del(keys));
        return chain;
      },
      exec: async () => {
        for (const op of ops) await op();
        return [];
      },
    };
    return chain;
  }
}

/** Persisted seat rows as `GameSessionsService` creates them: all unclaimed. */
function seatRows(): GameParticipant[] {
  return Array.from({ length: 4 }, (_, seatIndex) => ({
    uuid: crypto.randomUUID(),
    seatIndex,
    role: seatIndex === 0 ? ParticipantRole.Host : ParticipantRole.Player,
    displayName: `Seat ${seatIndex + 1}`,
    initialBalance: 1000,
    balance: 1000,
    claimedBy: null,
    claimedAt: null,
  })) as unknown as GameParticipant[];
}

function persistedSession(
  rows: GameParticipant[],
  overrides: Partial<{ closedAt: Nullable<Date> }> = {},
) {
  return {
    uuid: GAME_UUID,
    joinCode: JOIN_CODE,
    closedAt: null as Nullable<Date>,
    config: defaultGameConfig(),
    owner: { uuid: OWNER_UUID },
    participants: { getItems: () => rows },
    ...overrides,
  };
}

describe('GameRoomsService', () => {
  let redis: FakeRedisClient;
  let rows: GameParticipant[];
  let gameSessions: {
    create: jest.Mock;
    getGameSessionByUuid: jest.Mock;
    getGameSessionByJoinCode: jest.Mock;
    claim: jest.Mock;
    updateSeat: jest.Mock;
    syncBalances: jest.Mock;
    close: jest.Mock;
  };
  let users: { getUserByUuid: jest.Mock; findUserByUuid: jest.Mock };
  let runtime: GameRuntimeService;
  let service: GameRoomsService;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = new FakeRedisClient();
    rows = seatRows();
    gameSessions = {
      create: jest.fn(),
      getGameSessionByUuid: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Game session not found')),
      getGameSessionByJoinCode: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Game session not found')),
      claim: jest.fn().mockResolvedValue(undefined),
      updateSeat: jest.fn().mockResolvedValue(undefined),
      syncBalances: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    users = {
      getUserByUuid: jest
        .fn()
        .mockRejectedValue(new NotFoundException('User not found')),
      findUserByUuid: jest.fn().mockResolvedValue(null),
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

  it('lazily opens a room from the persisted session, seats included', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession(rows));

    expect(runtime.hasSession(GAME_UUID)).toBe(false);
    const snapshot = await service.ensureRoomOpen(GAME_UUID);

    expect(snapshot.id).toBe(GAME_UUID);
    expect(runtime.hasSession(GAME_UUID)).toBe(true);
    expect(snapshot.participants).toHaveLength(4);
    expect(snapshot.participants[0]).toMatchObject({
      role: ParticipantRole.Host,
      controller: null,
    });
  });

  it('closes an empty room after the idle TTL', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession(rows));
    await service.ensureRoomOpen(GAME_UUID);

    await jest.advanceTimersByTimeAsync(Constants.ROOM_IDLE_TTL_MS);

    expect(runtime.hasSession(GAME_UUID)).toBe(false);
  });

  it('keeps the room open while a socket is bound', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession(rows));
    gameSessions.getGameSessionByJoinCode.mockResolvedValue(
      persistedSession(rows),
    );
    await service.ensureRoomOpen(GAME_UUID);
    await service.bindSocket(JOIN_CODE, 'socket-1', OWNER_UUID);

    await jest.advanceTimersByTimeAsync(Constants.ROOM_IDLE_TTL_MS * 2);

    expect(runtime.hasSession(GAME_UUID)).toBe(true);
  });

  it('re-arms the idle closure when the last socket leaves', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession(rows));
    gameSessions.getGameSessionByJoinCode.mockResolvedValue(
      persistedSession(rows),
    );
    await service.ensureRoomOpen(GAME_UUID);
    await service.bindSocket(JOIN_CODE, 'socket-1', OWNER_UUID);

    const joinCode = await service.unbindSocket('socket-1');
    expect(joinCode).toBe(JOIN_CODE);
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
      persistedSession(rows, { closedAt: new Date('2026-01-01') }),
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
  });

  it('creates a game with its seats and opens the room', async () => {
    users.getUserByUuid.mockResolvedValue({
      uuid: OWNER_UUID,
      username: 'owner',
    });
    gameSessions.create.mockResolvedValue({
      session: persistedSession(rows),
      participants: rows,
    });

    const snapshot = await service.createGame(OWNER_UUID);

    expect(runtime.hasSession(GAME_UUID)).toBe(true);
    expect(snapshot.participants).toHaveLength(4);
    // Seats start unclaimed — the owner has host permissions without
    // occupying a seat.
    expect(snapshot.participants[0].controller).toBeNull();
  });

  it('persists the claim when a seat is taken', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession(rows));

    const snapshot = await service.claimSeat(GAME_UUID, {
      externalId: 'bob',
      displayName: 'Bob',
    });

    const bob = snapshot.participants.find((p) => p.controller === 'bob');
    expect(bob?.seatIndex).toBe(0);
    expect(gameSessions.claim).toHaveBeenCalledWith(rows[0], 'bob', 'Bob');
  });

  it('only lets the host close the game, then persists the outcome', async () => {
    gameSessions.getGameSessionByUuid.mockResolvedValue(persistedSession(rows));
    await service.ensureRoomOpen(GAME_UUID);

    await expect(service.closeGame(GAME_UUID, 'bob')).rejects.toThrow(
      ForbiddenException,
    );

    const snapshot = await service.closeGame(GAME_UUID, OWNER_UUID);

    expect(snapshot.status).toBe('FINISHED');
    expect(gameSessions.syncBalances).toHaveBeenCalledTimes(1);
    expect(gameSessions.close).toHaveBeenCalledTimes(1);
    expect(runtime.hasSession(GAME_UUID)).toBe(false);
  });
});
