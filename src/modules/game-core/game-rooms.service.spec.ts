import type { GameParticipant } from '@entities/game/game-participant.entity';
import type { GameSession } from '@entities/game/game-session.entity';
import type { MikroORM } from '@mikro-orm/core';
import type { ConfigService } from '@modules/config/config.service';
import type { GameCodesService } from '@modules/game-core/game-codes.service';
import type { GameLifecycleService } from '@modules/game-core/game-lifecycle.service';
import { defaultConfigFor } from '@modules/game-core/game-modes';
import type { GamePresenceService } from '@modules/game-core/game-presence.service';
import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import type { GameSessionsService } from '@modules/game-core/game-sessions.service';
import { GameTokensService } from '@modules/game-core/game-tokens.service';
import type { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  GameMode,
  GameSessionStatus,
  ParticipantRole,
  Plan,
  type GameConfig,
} from '@tokenizer/shared/types';

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
const JOIN_CODE = '481920';
/** The API requires a name, so every creation in here carries one. */
const GAME_NAME = "Owner's game";

/** Persisted seat rows as `GameSessionsService` creates them: all unclaimed. */
function seatRows(): GameParticipant[] {
  return Array.from({ length: 4 }, (_, seatIndex) => ({
    uuid: crypto.randomUUID(),
    seatIndex,
    role: seatIndex === 0 ? ParticipantRole.Host : ParticipantRole.Player,
    displayName: null,
    initialBalance: 1000,
    balance: 1000,
    claimedBy: null,
    claimedAt: null,
  })) as unknown as GameParticipant[];
}

function persistedSession(
  rows: GameParticipant[],
  overrides: Partial<GameSession> = {},
): GameSession {
  const session = {
    uuid: GAME_UUID,
    name: GAME_NAME,
    status: GameSessionStatus.Lobby,
    closedAt: null as Nullable<Date>,
    lastActivityAt: new Date(),
    config: defaultConfigFor(GameMode.Poker),
    owner: { uuid: OWNER_UUID, plan: Plan.Free },
    participants: { getItems: () => rows },
    ...overrides,
  };
  Object.defineProperty(session, 'isOpen', {
    get(this: typeof session) {
      return (
        this.closedAt === null &&
        (this.status === GameSessionStatus.Lobby ||
          this.status === GameSessionStatus.Running)
      );
    },
  });
  return session as unknown as GameSession;
}

describe('GameRoomsService', () => {
  let rows: GameParticipant[];
  let session: GameSession;
  let gameSessions: {
    create: jest.Mock;
    getGameSessionByUuid: jest.Mock;
    claim: jest.Mock;
    updateSeat: jest.Mock;
    syncBalances: jest.Mock;
    touch: jest.Mock;
    setStatus: jest.Mock;
    close: jest.Mock;
    findStale: jest.Mock;
    addParticipant: jest.Mock;
  };
  let users: { getUserByUuid: jest.Mock; findUserByUuid: jest.Mock };
  let codes: {
    issue: jest.Mock;
    resolve: jest.Mock;
    codeFor: jest.Mock;
    touch: jest.Mock;
    revoke: jest.Mock;
  };
  let presence: {
    isRoomEmpty: jest.Mock;
    connectedParticipants: jest.Mock;
    broadcast: jest.Mock;
    closeRoom: jest.Mock;
  };
  let lifecycle: {
    scheduleRoomClosure: jest.Mock;
    cancelRoomClosure: jest.Mock;
    scheduleRoomTeardown: jest.Mock;
    cancelRoomTeardown: jest.Mock;
    schedulePlayerDeparture: jest.Mock;
    cancelPlayerDeparture: jest.Mock;
  };
  let tokens: GameTokensService;
  let runtime: GameRuntimeService;
  let service: GameRoomsService;

  beforeEach(() => {
    rows = seatRows();
    session = persistedSession(rows);

    gameSessions = {
      create: jest.fn().mockResolvedValue({ session, participants: rows }),
      getGameSessionByUuid: jest.fn().mockResolvedValue(session),
      claim: jest
        .fn()
        .mockImplementation((row: GameParticipant, holder: string) => {
          row.claimedBy = holder;
          row.claimedAt = new Date();
          return Promise.resolve(row);
        }),
      updateSeat: jest.fn().mockResolvedValue(undefined),
      syncBalances: jest.fn().mockResolvedValue(undefined),
      touch: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(session),
      close: jest
        .fn()
        .mockImplementation((s: GameSession, status: GameSessionStatus) => {
          s.status = status;
          (s as { closedAt: Nullable<Date> }).closedAt = new Date();
          return Promise.resolve(s);
        }),
      findStale: jest.fn().mockResolvedValue([]),
      addParticipant: jest
        .fn()
        .mockImplementation(
          (
            _session: GameSession,
            seatIndex: number,
            displayName: string,
            initialBalance: number,
          ) => {
            const row = {
              uuid: crypto.randomUUID(),
              seatIndex,
              role: ParticipantRole.Player,
              displayName,
              initialBalance,
              balance: initialBalance,
              claimedBy: null,
              claimedAt: null,
            } as unknown as GameParticipant;
            rows.push(row);
            return Promise.resolve(row);
          },
        ),
    };
    users = {
      getUserByUuid: jest.fn().mockResolvedValue({
        uuid: OWNER_UUID,
        username: 'owner',
        displayName: 'Owner',
        avatar: null,
        plan: Plan.Free,
      }),
      findUserByUuid: jest.fn().mockResolvedValue(null),
    };
    codes = {
      issue: jest.fn().mockResolvedValue(JOIN_CODE),
      resolve: jest.fn().mockResolvedValue(null),
      codeFor: jest.fn().mockResolvedValue(JOIN_CODE),
      touch: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    presence = {
      isRoomEmpty: jest.fn().mockReturnValue(true),
      connectedParticipants: jest.fn().mockReturnValue(new Set<string>()),
      broadcast: jest.fn(),
      closeRoom: jest.fn(),
    };
    lifecycle = {
      scheduleRoomClosure: jest.fn().mockResolvedValue(undefined),
      cancelRoomClosure: jest.fn().mockResolvedValue(undefined),
      scheduleRoomTeardown: jest.fn().mockResolvedValue(undefined),
      cancelRoomTeardown: jest.fn().mockResolvedValue(undefined),
      schedulePlayerDeparture: jest.fn().mockResolvedValue(undefined),
      cancelPlayerDeparture: jest.fn().mockResolvedValue(undefined),
    };
    tokens = new GameTokensService(new JwtService(), {
      get: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService);
    runtime = new GameRuntimeService();

    service = new GameRoomsService(
      {} as MikroORM,
      gameSessions as unknown as GameSessionsService,
      users as unknown as UsersService,
      runtime,
      codes as unknown as GameCodesService,
      presence as unknown as GamePresenceService,
      lifecycle as unknown as GameLifecycleService,
      tokens,
    );
  });

  describe('createGame', () => {
    it('mints a code, seats the owner in the HOST seat and issues their token', async () => {
      const result = await service.createGame(OWNER_UUID, {
        name: GAME_NAME,
        mode: GameMode.Poker,
      });

      expect(codes.issue).toHaveBeenCalledWith(GAME_UUID);
      expect(result.snapshot.joinCode).toBe(JOIN_CODE);

      const host = result.snapshot.participants.find(
        (p) => p.role === ParticipantRole.Host,
      );
      expect(host?.id).toBe(result.participantId);
      expect(host?.claimed).toBe(true);
      expect(tokens.verify(result.token, GAME_UUID)).toMatchObject({
        participantId: result.participantId,
      });
    });

    it('refuses to create a game for anything but a real user uuid', async () => {
      await expect(
        service.createGame('not-a-uuid', {
          name: GAME_NAME,
          mode: GameMode.Poker,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    describe('plan limits', () => {
      const configWithSeats = (count: number): GameConfig => {
        const config = defaultConfigFor(GameMode.Poker);
        return {
          ...config,
          seating: {
            ...config.seating,
            seats: Array.from({ length: count }, (_, index) => ({
              displayName: `Seat ${index + 1}`,
            })),
          },
        };
      };

      // How configurable a table is belongs to the mode, not to the plan: a
      // host who may open the game may set it up. What the plan still caps is
      // how many chairs are round it, which is the assertion below.
      it('lets a free user set up the mode they are allowed to open', async () => {
        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Poker,
            config: defaultConfigFor(GameMode.Poker),
          }),
        ).resolves.toBeDefined();
      });

      it('lets a free user open the mode on its own defaults', async () => {
        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Poker,
          }),
        ).resolves.toBeDefined();
      });

      it('lets a premium user submit a custom config within their seat cap', async () => {
        users.getUserByUuid.mockResolvedValueOnce({
          uuid: OWNER_UUID,
          username: 'owner',
          displayName: 'Owner',
          avatar: null,
          plan: Plan.Premium,
        });

        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Poker,
            config: configWithSeats(12),
          }),
        ).resolves.toBeDefined();
      });

      it('rejects a premium user exceeding their own, higher seat cap', async () => {
        users.getUserByUuid.mockResolvedValueOnce({
          uuid: OWNER_UUID,
          username: 'owner',
          displayName: 'Owner',
          avatar: null,
          plan: Plan.Premium,
        });

        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Poker,
            config: configWithSeats(13),
          }),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('modes', () => {
      it('lets a free user open a table in a mode their plan includes', async () => {
        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Poker,
          }),
        ).resolves.toBeDefined();
      });

      it('rejects a mode the plan does not include', async () => {
        users.getUserByUuid.mockResolvedValueOnce({
          uuid: OWNER_UUID,
          username: 'owner',
          displayName: 'Owner',
          avatar: null,
          plan: Plan.Anonymous,
        });

        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Poker,
          }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('refuses the free table to a plan that does not pay for it', async () => {
        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Free,
          }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('opens the free table for a plan that does', async () => {
        users.getUserByUuid.mockResolvedValueOnce({
          uuid: OWNER_UUID,
          username: 'owner',
          displayName: 'Owner',
          avatar: null,
          plan: Plan.Premium,
        });

        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Free,
          }),
        ).resolves.toBeDefined();
      });

      it('answers what a host may open a table in, poker first', () => {
        expect(service.listModes().map((entry) => entry.mode)).toEqual([
          GameMode.Poker,
          GameMode.Free,
        ]);
      });

      it('says out loud which of the modes is still an experiment', () => {
        const experimental = service
          .listModes()
          .filter((entry) => entry.experimental)
          .map((entry) => entry.mode);

        expect(experimental).toEqual([GameMode.Free]);
      });
    });

    describe('seats override', () => {
      const seatsOf = (count: number) =>
        Array.from({ length: count }, (_, index) => ({
          displayName: `Seat ${index + 1}`,
        }));

      it("lets a free user override the mode's seat count, within their cap", async () => {
        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Poker,
            seats: seatsOf(2),
          }),
        ).resolves.toBeDefined();
      });

      it('rejects a free user overriding the seats beyond their cap', async () => {
        await expect(
          service.createGame(OWNER_UUID, {
            name: GAME_NAME,
            mode: GameMode.Poker,
            seats: seatsOf(5),
          }),
        ).rejects.toThrow(ForbiddenException);
      });
    });
  });

  describe('joinGame', () => {
    beforeEach(async () => {
      await service.createGame(OWNER_UUID, {
        name: GAME_NAME,
        mode: GameMode.Poker,
      });
    });

    it('seats a guest, issues a token, and never puts them in the host seat', async () => {
      const result = await service.joinGame(GAME_UUID, { displayName: 'Bob' });

      const bob = result.snapshot.participants.find(
        (p) => p.id === result.participantId,
      );
      expect(bob?.role).toBe(ParticipantRole.Player);
      expect(bob?.seatIndex).toBe(1);
      expect(bob?.displayName).toBe('Bob');
      expect(tokens.verify(result.token, GAME_UUID).participantId).toBe(
        result.participantId,
      );
    });

    it('gives a returning player their seat back when they present their token', async () => {
      const first = await service.joinGame(GAME_UUID, { displayName: 'Bob' });

      // A page refresh: same token, same seat, no second chair taken.
      const again = await service.joinGame(GAME_UUID, { token: first.token });

      expect(again.participantId).toBe(first.participantId);
      expect(again.snapshot.participants.filter((p) => p.claimed)).toHaveLength(
        2,
      ); // the host and Bob, not three
    });

    it('gives a signed-in player their seat back without a token', async () => {
      const userUuid = '55555555-5555-4555-8555-555555555555';
      const first = await service.joinGame(GAME_UUID, {}, userUuid);

      const again = await service.joinGame(GAME_UUID, {}, userUuid);

      expect(again.participantId).toBe(first.participantId);
    });

    it('refuses a token minted for a different game', async () => {
      const foreign = tokens.issue({
        gameUuid: '99999999-9999-4999-8999-999999999999',
        participantId: rows[1].uuid,
      });

      await expect(
        service.joinGame(GAME_UUID, { token: foreign }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses to join a closed session', async () => {
      session.status = GameSessionStatus.Abandoned;
      (session as { closedAt: Nullable<Date> }).closedAt = new Date();

      await expect(service.joinGame(GAME_UUID, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('pulling up a chair at a full table', () => {
      /** Fills every declared seat, which is what `canAddSeat` asks for. */
      const fillTheTable = async () => {
        for (let seat = 1; seat < rows.length; seat++) {
          await service.joinGame(GAME_UUID, { seatIndex: seat });
        }
      };

      /** Four declared seats against a four-seat cap can never grow. */
      const withRoomToGrow = () => {
        (session.owner as { plan: Plan }).plan = Plan.Premium;
      };

      it('opens a seat and sits the newcomer in it, in one call', async () => {
        withRoomToGrow();
        await fillTheTable();

        const result = await service.joinGame(GAME_UUID, {
          displayName: 'Late',
          openExtraSeat: true,
        });

        const seats = result.snapshot.participants;
        expect(seats).toHaveLength(5);
        // The chair it opened is the chair it sat in: a table never grows a
        // seat that nobody is holding.
        const late = seats.find((p) => p.id === result.participantId);
        expect(late?.seatIndex).toBe(4);
        expect(late?.claimed).toBe(true);
        expect(late?.displayName).toBe('Late');
        expect(seats.every((p) => p.claimed)).toBe(true);
      });

      it('refuses while a free chair is still going', async () => {
        withRoomToGrow();

        await expect(
          service.joinGame(GAME_UUID, { openExtraSeat: true }),
        ).rejects.toThrow(/free seat/i);
        expect(gameSessions.addParticipant).not.toHaveBeenCalled();
      });

      it("refuses past the owner's plan cap", async () => {
        // Four declared seats on a plan that stops at four: full is as big as
        // this table gets, whoever turns up.
        await fillTheTable();

        await expect(
          service.joinGame(GAME_UUID, { openExtraSeat: true }),
        ).rejects.toThrow(ForbiddenException);
        expect(gameSessions.addParticipant).not.toHaveBeenCalled();
      });

      it('refuses at a table whose size the host fixed', async () => {
        withRoomToGrow();
        const config = defaultConfigFor(GameMode.Poker);
        session.config = {
          ...config,
          seating: { ...config.seating, allowExtraSeats: false },
        };
        runtime.disposeSession(GAME_UUID);
        await service.ensureRoomOpen(GAME_UUID);
        await fillTheTable();

        await expect(
          service.joinGame(GAME_UUID, { openExtraSeat: true }),
        ).rejects.toThrow(/fixed number of seats/i);
      });
    });
  });

  describe('host-only transitions', () => {
    let hostToken: string;
    let hostSeat: string;
    let playerSeat: string;

    beforeEach(async () => {
      const host = await service.createGame(OWNER_UUID, {
        name: GAME_NAME,
        mode: GameMode.Poker,
      });
      hostToken = host.token;
      hostSeat = host.participantId;
      playerSeat = (await service.joinGame(GAME_UUID, { displayName: 'Bob' }))
        .participantId;
    });

    it('lets the HOST seat deal a hand', async () => {
      const { snapshot } = await service.startHand(GAME_UUID, hostSeat);

      expect(
        snapshot.mode === GameMode.Poker ? snapshot.currentHand : null,
      ).not.toBeNull();
      expect(gameSessions.setStatus).toHaveBeenCalledWith(
        session,
        GameSessionStatus.Running,
      );
    });

    it('refuses a player seat dealing a hand', async () => {
      await expect(service.startHand(GAME_UUID, playerSeat)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a player seat closing the game', async () => {
      await expect(service.closeGame(GAME_UUID, playerSeat)).rejects.toThrow(
        ForbiddenException,
      );
      expect(gameSessions.close).not.toHaveBeenCalled();
    });

    it('settles balances and retires the code on close', async () => {
      await service.closeGame(GAME_UUID, hostSeat);

      expect(gameSessions.syncBalances).toHaveBeenCalled();
      expect(gameSessions.close).toHaveBeenCalledWith(
        session,
        GameSessionStatus.Finished,
      );
      expect(codes.revoke).toHaveBeenCalledWith(GAME_UUID);
      // hostToken is now worth nothing: the session refuses to re-open.
      expect(tokens.verify(hostToken, GAME_UUID)).toBeDefined();
      await expect(service.ensureRoomOpen(GAME_UUID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('keeps the room up so the table can be told it is over', async () => {
      await service.closeGame(GAME_UUID, hostSeat);

      // The caller broadcasts the final snapshot into this very room; dropping
      // the sockets here would empty it before the message went out.
      expect(presence.closeRoom).not.toHaveBeenCalled();
      expect(runtime.hasSession(GAME_UUID)).toBe(true);
      expect(lifecycle.scheduleRoomTeardown).toHaveBeenCalledWith(GAME_UUID);
    });

    it('reclaims the room when the last viewer closes the recap', async () => {
      await service.closeGame(GAME_UUID, hostSeat);
      presence.isRoomEmpty.mockReturnValue(true);

      await service.onPlayerDisconnected(GAME_UUID, hostSeat);

      expect(presence.closeRoom).toHaveBeenCalledWith(GAME_UUID);
      expect(runtime.hasSession(GAME_UUID)).toBe(false);
      // Nothing to abandon and nobody to tell: the table is already over.
      expect(lifecycle.scheduleRoomClosure).not.toHaveBeenCalled();
      expect(lifecycle.schedulePlayerDeparture).not.toHaveBeenCalled();
    });

    it('holds the recap open while somebody is still reading it', async () => {
      await service.closeGame(GAME_UUID, hostSeat);
      presence.isRoomEmpty.mockReturnValue(false);

      await service.onPlayerDisconnected(GAME_UUID, hostSeat);

      expect(presence.closeRoom).not.toHaveBeenCalled();
      expect(runtime.hasSession(GAME_UUID)).toBe(true);
    });

    it('reclaims the room from the backstop when nobody ever leaves', async () => {
      await service.closeGame(GAME_UUID, hostSeat);

      await service.teardownClosedRoom(GAME_UUID);

      expect(presence.closeRoom).toHaveBeenCalledWith(GAME_UUID);
      expect(runtime.hasSession(GAME_UUID)).toBe(false);
    });
  });

  describe('connection lifecycle', () => {
    beforeEach(async () => {
      await service.createGame(OWNER_UUID, {
        name: GAME_NAME,
        mode: GameMode.Poker,
      });
    });

    it('starts both clocks when the last socket of a room drops', async () => {
      presence.isRoomEmpty.mockReturnValue(true);

      await service.onPlayerDisconnected(GAME_UUID, rows[0].uuid);

      expect(lifecycle.schedulePlayerDeparture).toHaveBeenCalledWith(
        GAME_UUID,
        rows[0].uuid,
      );
      expect(lifecycle.scheduleRoomClosure).toHaveBeenCalledWith(GAME_UUID);
    });

    it('tells the table immediately, without waiting out the grace period', async () => {
      // `connected` flips the moment the socket goes; the 15s job decides
      // whether they *left*, not whether they are currently there.
      await service.onPlayerDisconnected(GAME_UUID, rows[0].uuid);

      expect(presence.broadcast).toHaveBeenCalledWith(
        GAME_UUID,
        'game:participant_disconnected',
        expect.objectContaining({ participantId: rows[0].uuid }),
      );
    });

    it('starts only the player clock while others are still connected', async () => {
      presence.isRoomEmpty.mockReturnValue(false);

      await service.onPlayerDisconnected(GAME_UUID, rows[0].uuid);

      expect(lifecycle.schedulePlayerDeparture).toHaveBeenCalled();
      expect(lifecycle.scheduleRoomClosure).not.toHaveBeenCalled();
    });

    it('calls both clocks off and slides the code when someone connects', async () => {
      await service.onPlayerConnected(GAME_UUID, rows[0].uuid);

      expect(lifecycle.cancelRoomClosure).toHaveBeenCalledWith(GAME_UUID);
      expect(lifecycle.cancelPlayerDeparture).toHaveBeenCalledWith(
        GAME_UUID,
        rows[0].uuid,
      );
      expect(codes.touch).toHaveBeenCalledWith(GAME_UUID);
    });
  });

  describe('abandonGame', () => {
    beforeEach(async () => {
      await service.createGame(OWNER_UUID, {
        name: GAME_NAME,
        mode: GameMode.Poker,
      });
    });

    it('marks the session abandoned and tears the room down', async () => {
      await service.abandonGame(GAME_UUID);

      expect(gameSessions.close).toHaveBeenCalledWith(
        session,
        GameSessionStatus.Abandoned,
      );
      expect(gameSessions.syncBalances).toHaveBeenCalled();
      expect(presence.closeRoom).toHaveBeenCalledWith(GAME_UUID);
      expect(runtime.hasSession(GAME_UUID)).toBe(false);
    });

    it('does nothing to a session that is already closed', async () => {
      session.status = GameSessionStatus.Finished;
      (session as { closedAt: Nullable<Date> }).closedAt = new Date();
      gameSessions.close.mockClear();

      await service.abandonGame(GAME_UUID);

      expect(gameSessions.close).not.toHaveBeenCalled();
    });

    it('shrugs off a session that no longer exists', async () => {
      gameSessions.getGameSessionByUuid.mockRejectedValue(
        new NotFoundException('Game session not found'),
      );

      await expect(service.abandonGame(GAME_UUID)).resolves.toBeUndefined();
    });
  });

  describe('sweepStaleSessions', () => {
    it('closes a stale session whose room really is empty', async () => {
      gameSessions.findStale.mockResolvedValue([session]);
      presence.isRoomEmpty.mockReturnValue(true);

      await expect(service.sweepStaleSessions()).resolves.toBe(1);
      expect(gameSessions.close).toHaveBeenCalledWith(
        session,
        GameSessionStatus.Abandoned,
      );
    });

    it('spares a session that looks stale but still has players in it', async () => {
      // A long think between actions is not an abandoned game; presence has
      // the last word here as it does everywhere else.
      gameSessions.findStale.mockResolvedValue([session]);
      presence.isRoomEmpty.mockReturnValue(false);

      await service.sweepStaleSessions();

      expect(gameSessions.close).not.toHaveBeenCalled();
    });
  });

  describe('resolveCode', () => {
    it('returns the same null for an unknown code and an expired one', async () => {
      codes.resolve.mockResolvedValue(null);

      expect(await service.resolveCode('000000')).toBeNull();
      expect(await service.resolveCode('999999')).toBeNull();
    });
  });

  describe('publicRoomView', () => {
    it('shows the name, status and fill level — and not the uuid', async () => {
      rows[0].claimedBy = OWNER_UUID;

      const view = await service.publicRoomView(GAME_UUID);

      expect(view).toEqual({
        name: GAME_NAME,
        mode: GameMode.Poker,
        status: GameSessionStatus.Lobby,
        playerCount: 1,
        seatCount: 4,
      });
      expect(Object.values(view)).not.toContain(GAME_UUID);
    });
  });

  describe('snapshots', () => {
    it('never carries the identity holding a seat', async () => {
      const { snapshot } = await service.createGame(OWNER_UUID, {
        name: GAME_NAME,
        mode: GameMode.Poker,
      });

      // A snapshot reaches every socket in the room. Before player tokens, it
      // carried each seat's externalId — a signed-in player's user uuid — and
      // anyone at the table could replay it to act as them.
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain(OWNER_UUID);
      for (const seat of snapshot.participants) {
        expect(seat).not.toHaveProperty('controller');
      }
    });

    it('marks who is connected without touching who holds the seat', async () => {
      const { snapshot: before, participantId } = await service.createGame(
        OWNER_UUID,
        { name: GAME_NAME, mode: GameMode.Poker },
      );
      expect(
        before.participants.find((p) => p.id === participantId)?.connected,
      ).toBe(false);

      presence.connectedParticipants.mockReturnValue(new Set([participantId]));
      const after = await service.ensureRoomOpen(GAME_UUID);

      const host = after.participants.find((p) => p.id === participantId);
      expect(host?.connected).toBe(true);
      expect(host?.claimed).toBe(true);
    });
  });
});
