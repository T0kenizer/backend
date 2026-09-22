import type { GameParticipant } from '@entities/game/game-participant.entity';
import type { GameSession } from '@entities/game/game-session.entity';
import { CreateRequestContext, MikroORM } from '@mikro-orm/core';
import { GameCodesService } from '@modules/game-core/game-codes.service';
import * as Constants from '@modules/game-core/game-core.constants';
import type { SeatInit } from '@modules/game-core/game-core.types';
import { GameLifecycleService } from '@modules/game-core/game-lifecycle.service';
import { GamePresenceService } from '@modules/game-core/game-presence.service';
import {
  GAME_TEMPLATES,
  defaultGameConfig,
} from '@modules/game-core/game-runtime.presets';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import type {
  RawParticipantSnapshot,
  RuntimeSnapshot,
} from '@modules/game-core/game-runtime.snapshot';
import { GameSessionsService } from '@modules/game-core/game-sessions.service';
import { GameTokensService } from '@modules/game-core/game-tokens.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GAME_SERVER_EVENTS } from '@tokenizer/shared/constants/games.constants';
import { gameConfigSchema } from '@tokenizer/shared/schemas';
import {
  GameSessionStatus,
  type ClaimSeatData,
  type GameConfig,
  type GameSnapshot,
  type GameTemplate,
  type ParticipantSnapshot,
  type PublicRoomView,
  type RoundResolution,
  type SubmitActionData,
  type UpdateSeatData,
} from '@tokenizer/shared/types';
import { randomUUID } from 'crypto';
import { z } from 'zod';

/** What a successful join hands back to the client. */
export interface JoinResult {
  snapshot: GameSnapshot;
  token: string;
  participantId: string;
}

/**
 * Orchestrates game rooms on top of the persisted `GameSession` rows.
 *
 * Three things are kept strictly apart here:
 *
 * - **Postgres** holds everything that must survive: status, seats, balances,
 *   claims, activity. It is the only thing consulted to answer "does this game
 *   exist, and can it still be played?".
 * - **Redis** holds the 6-digit code and nothing else. A room whose code has
 *   lapsed is still perfectly playable by uuid, which is why losing Redis costs
 *   nothing but the shortcut.
 * - **The Socket.IO adapter** holds presence. It is where the connections already
 *   are; duplicating them elsewhere would only create a second answer that can
 *   disagree with the first.
 *
 * The in-memory runtime aggregate is a cache of the persisted rows, not a
 * source of truth: it is rebuilt from them whenever a room opens, and every
 * settlement is written back.
 */
@Injectable()
export class GameRoomsService {
  private readonly logger = new Logger(GameRoomsService.name);

  // `orm` backs @CreateRequestContext(): entry points outside the HTTP
  // request scope (WebSocket gateway, queue consumer) get a fresh DB context.
  constructor(
    private readonly orm: MikroORM,
    private readonly gameSessionsService: GameSessionsService,
    private readonly usersService: UsersService,
    private readonly runtime: GameRuntimeService,
    private readonly codes: GameCodesService,
    private readonly presence: GamePresenceService,
    private readonly lifecycle: GameLifecycleService,
    private readonly tokens: GameTokensService,
  ) {}

  /**
   * Creates a session, mints its code, and seats the owner in the HOST seat.
   * The owner leaves with a player token like everyone else — host authority is
   * carried by the seat, not by the identity that happens to hold it.
   */
  @CreateRequestContext()
  async createGame(
    ownerUuid: string,
    config?: GameConfig,
    name?: string,
  ): Promise<JoinResult> {
    if (!z.uuid().safeParse(ownerUuid).success) {
      throw new BadRequestException(
        'Creating a game requires an authenticated user uuid',
      );
    }

    const owner = await this.usersService.getUserByUuid(ownerUuid);
    const gameConfig = config ?? defaultGameConfig();
    const { session, participants } = await this.gameSessionsService.create(
      owner,
      gameConfig,
      name,
    );

    this.runtime.registerSession(
      session.uuid,
      gameConfig,
      owner.uuid,
      seatInits(participants),
    );
    await this.codes.issue(session.uuid);

    // The host seat is seat 0, claimed by the creator as part of creating —
    // in the runtime as well as the row, or the aggregate would show the chair
    // empty and hand it to the next player through the door.
    const { participantId } = this.runtime.claimSeat(session.uuid, {
      holderId: owner.uuid,
      seatIndex: 0,
    });
    return this.seatPlayer(session, participantId, owner.uuid);
  }

  /** The templates a host may open a game from instead of building one. */
  listTemplates(): readonly GameTemplate[] {
    return GAME_TEMPLATES;
  }

  /**
   * Resolves a 6-digit code to the session uuid it stands for.
   *
   * Returns null for a code that never existed and for one that has expired
   * alike — the caller must not be able to tell the two apart, or the endpoint
   * becomes an oracle for which codes were ever issued.
   */
  async resolveCode(code: string): Promise<Nullable<string>> {
    return this.codes.resolve(code);
  }

  /**
   * The lightweight public view behind a code: enough for a stranger to confirm
   * they are joining the right game, and nothing else. Notably not the session
   * uuid — handing that out is `join-by-code`'s job, and it is rate-limited
   * separately.
   */
  @CreateRequestContext()
  async publicRoomView(gameUuid: string): Promise<PublicRoomView> {
    const session =
      await this.gameSessionsService.getGameSessionByUuid(gameUuid);
    const seats = session.participants.getItems();

    return {
      name: session.name,
      status: session.status,
      playerCount: seats.filter((p) => p.claimedBy !== null).length,
      seatCount: seats.length,
    };
  }

  /**
   * Opens the room if it is not already open, rebuilding the runtime aggregate
   * from the persisted rows. Postgres decides whether the game exists and can
   * still be played; the runtime is only a cache of what it says.
   */
  @CreateRequestContext()
  async ensureRoomOpen(gameUuid: string): Promise<GameSnapshot> {
    const session = await this.loadPlayableSession(gameUuid);
    const config = gameConfigSchema.parse(session.config);

    if (!this.runtime.hasSession(gameUuid)) {
      this.runtime.registerSession(
        session.uuid,
        config,
        session.owner.uuid,
        seatInits(session.participants.getItems()),
      );
      this.logger.log(`Room ${gameUuid} opened from persisted session`);
    }

    return this.finalize(this.runtime.snapshot(gameUuid), session);
  }

  /**
   * Seats a player and issues their token.
   *
   * A token presented here is a reconnection: it names the seat its holder
   * already owns, so a refresh lands back where it left off. Without one, the
   * identity is decided server-side — the signed-in user's uuid, or a fresh
   * anonymous id — never anything the client supplied.
   */
  @CreateRequestContext()
  async joinGame(
    gameUuid: string,
    data: ClaimSeatData,
    userUuid?: string,
  ): Promise<JoinResult> {
    await this.ensureRoomOpen(gameUuid);
    const session = await this.loadPlayableSession(gameUuid);

    if (data.token) {
      const { participantId } = this.tokens.verify(data.token, gameUuid);
      const seat = session.participants
        .getItems()
        .find((p) => p.uuid === participantId);
      if (!seat) throw new NotFoundException('Seat not found in this game');

      if (data.displayName !== undefined) {
        this.runtime.updateSeat(gameUuid, {
          participantId,
          displayName: data.displayName,
        });
        await this.gameSessionsService.updateSeat(seat, data.displayName);
      }
      return this.seatPlayer(
        session,
        participantId,
        seat.claimedBy ?? undefined,
      );
    }

    // A signed-in player rejoining without their token is still the same
    // person: their uuid finds the seat they already hold.
    const holderId = userUuid ?? `anon:${randomUUID()}`;
    const existing = this.runtime.findSeatByHolder(gameUuid, holderId);
    if (existing) return this.seatPlayer(session, existing, holderId);

    const { participantId } = this.runtime.claimSeat(gameUuid, {
      holderId,
      displayName: data.displayName,
      seatIndex: data.seatIndex,
    });

    const row = session.participants
      .getItems()
      .find((p) => p.uuid === participantId);
    if (row) {
      await this.gameSessionsService.claim(row, holderId, data.displayName);
    }

    return this.seatPlayer(session, participantId, holderId);
  }

  /** Renames the caller's own seat; persists the change. */
  @CreateRequestContext()
  async updateSeat(
    gameUuid: string,
    participantId: string,
    data: UpdateSeatData,
  ): Promise<GameSnapshot> {
    await this.ensureRoomOpen(gameUuid);
    this.runtime.updateSeat(gameUuid, {
      participantId,
      displayName: data.displayName,
    });

    const session = await this.loadPlayableSession(gameUuid);
    const row = session.participants
      .getItems()
      .find((p) => p.uuid === participantId);
    if (row) await this.gameSessionsService.updateSeat(row, data.displayName);

    await this.noteActivity(session);
    return this.finalize(this.runtime.snapshot(gameUuid), session);
  }

  /** Host-only: starts a round. */
  @CreateRequestContext()
  async startRound(
    gameUuid: string,
    participantId: string,
  ): Promise<GameSnapshot> {
    await this.ensureRoomOpen(gameUuid);
    this.assertHost(gameUuid, participantId);

    const snapshot = this.runtime.startRound(gameUuid);
    const session = await this.loadPlayableSession(gameUuid);
    await this.gameSessionsService.setStatus(
      session,
      GameSessionStatus.Running,
    );
    await this.codes.touch(gameUuid);

    return this.finalize(snapshot, session);
  }

  /** Applies an action; when it settles the round, balances are persisted. */
  @CreateRequestContext()
  async submitAction(
    gameUuid: string,
    participantId: string,
    data: SubmitActionData,
  ): Promise<{ snapshot: GameSnapshot; resolution?: RoundResolution }> {
    await this.ensureRoomOpen(gameUuid);
    const result = this.runtime.submitAction(gameUuid, participantId, data);

    const session = await this.loadPlayableSession(gameUuid);
    if (result.resolution) {
      await this.persistBalances(gameUuid, session);
    } else {
      await this.noteActivity(session);
    }

    return {
      ...result,
      snapshot: await this.finalize(result.snapshot, session),
    };
  }

  /** Host-only: manual round resolution; balances are persisted. */
  @CreateRequestContext()
  async resolveRound(
    gameUuid: string,
    participantId: string,
    winnerParticipantIds?: string[],
  ): Promise<{ snapshot: GameSnapshot; resolution: RoundResolution }> {
    await this.ensureRoomOpen(gameUuid);
    this.assertHost(gameUuid, participantId);

    const result = this.runtime.resolveRound(gameUuid, winnerParticipantIds);
    const session = await this.loadPlayableSession(gameUuid);
    await this.persistBalances(gameUuid, session);

    return {
      ...result,
      snapshot: await this.finalize(result.snapshot, session),
    };
  }

  /**
   * Host-only termination: settles the final balances, stamps the row so the
   * room can never re-open, retires the code and drops every socket.
   */
  @CreateRequestContext()
  async closeGame(
    gameUuid: string,
    participantId: string,
  ): Promise<GameSnapshot> {
    await this.ensureRoomOpen(gameUuid);
    this.assertHost(gameUuid, participantId);

    const snapshot = this.runtime.closeSession(gameUuid);
    const session = await this.loadPlayableSession(gameUuid);
    await this.gameSessionsService.syncBalances(session, balancesOf(snapshot));
    await this.gameSessionsService.close(session, GameSessionStatus.Finished);

    const finalized = await this.finalize(snapshot, session);
    await this.teardown(gameUuid);
    return finalized;
  }

  /**
   * The empty-room job's verdict: nobody came back, so the session is over.
   *
   * Redis is deliberately left alone — the code's TTL retires it without anyone
   * having to remember to, which is the whole reason the code has one.
   */
  @CreateRequestContext()
  async abandonGame(gameUuid: string): Promise<void> {
    let session: GameSession;
    try {
      session = await this.gameSessionsService.getGameSessionByUuid(gameUuid);
    } catch {
      return; // Already gone; nothing to abandon.
    }
    if (!session.isOpen) return;

    if (this.runtime.hasSession(gameUuid)) {
      const snapshot = this.runtime.snapshot(gameUuid);
      await this.gameSessionsService.syncBalances(
        session,
        balancesOf(snapshot),
      );
    }
    await this.gameSessionsService.close(session, GameSessionStatus.Abandoned);

    this.presence.broadcast(gameUuid, GAME_SERVER_EVENTS.SESSION_CLOSED, {
      id: gameUuid,
      status: GameSessionStatus.Abandoned,
    });
    await this.teardown(gameUuid);
    this.logger.log(
      `Session ${gameUuid} abandoned after an empty grace period`,
    );
  }

  /**
   * The per-player job's verdict: this seat's holder did not come back inside
   * their grace period. The seat stays theirs — their token still reclaims it,
   * and freeing a seat mid-round would corrupt the game — but the table is
   * told, so everyone sees who is actually there.
   */
  @CreateRequestContext()
  async announceDeparture(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.broadcastPresence(
      gameUuid,
      participantId,
      GAME_SERVER_EVENTS.PARTICIPANT_LEFT,
    );
  }

  /** Shared body of the two presence announcements. */
  private async broadcastPresence(
    gameUuid: string,
    participantId: string,
    event: string,
  ): Promise<void> {
    if (!this.runtime.hasSession(gameUuid)) return;

    let session: GameSession;
    try {
      session = await this.gameSessionsService.getGameSessionByUuid(gameUuid);
    } catch {
      return; // The session is gone; there is no room left to tell.
    }

    const snapshot = await this.finalize(
      this.runtime.snapshot(gameUuid),
      session,
    );
    this.presence.broadcast(gameUuid, event, { ...snapshot, participantId });
  }

  /**
   * The safety net. Closes sessions still marked playable that have been silent
   * past the threshold — the ones whose lifecycle job was lost to a restart,
   * and which nothing else would ever look at again.
   */
  @CreateRequestContext()
  async sweepStaleSessions(): Promise<number> {
    const threshold = new Date(
      Date.now() - Constants.STALE_SESSION_THRESHOLD_MS,
    );
    const stale = await this.gameSessionsService.findStale(threshold);

    for (const session of stale) {
      // A session can be stale on paper and busy in fact (a long think between
      // actions); presence has the last word, as everywhere else.
      if (!this.presence.isRoomEmpty(session.uuid)) continue;
      await this.gameSessionsService.close(
        session,
        GameSessionStatus.Abandoned,
      );
      await this.teardown(session.uuid);
    }

    if (stale.length) {
      this.logger.warn(
        `Stale sweep closed ${stale.length} session(s) idle for over ` +
          `${Constants.STALE_SESSION_THRESHOLD_MS / 60_000}min`,
      );
    }
    return stale.length;
  }

  /** Someone is in the room again: the pending closure no longer applies. */
  async onPlayerConnected(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.lifecycle.cancelRoomClosure(gameUuid);
    await this.lifecycle.cancelPlayerDeparture(gameUuid, participantId);
    await this.codes.touch(gameUuid);
  }

  /**
   * A socket dropped. Two independent clocks start: a short one for the player
   * (a refresh must not read as leaving) and, only if the room is now empty, a
   * long one for the session itself.
   */
  async onPlayerDisconnected(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.lifecycle.schedulePlayerDeparture(gameUuid, participantId);
    if (this.presence.isRoomEmpty(gameUuid)) {
      await this.lifecycle.scheduleRoomClosure(gameUuid);
    }
    // Tell the table straight away: `connected` flipped the moment the socket
    // went, and staying silent until the grace period expires would leave
    // everyone looking at a seat that stopped answering fifteen seconds ago.
    await this.announceDisconnect(gameUuid, participantId);
  }

  /** Broadcasts the room as it stands, with this seat now showing as away. */
  @CreateRequestContext()
  async announceDisconnect(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.broadcastPresence(
      gameUuid,
      participantId,
      GAME_SERVER_EVENTS.PARTICIPANT_DISCONNECTED,
    );
  }

  /** Whether a token's seat may drive host-only transitions. */
  private assertHost(gameUuid: string, participantId: string): void {
    if (!this.runtime.isHost(gameUuid, participantId)) {
      throw new ForbiddenException('Only the host can perform this action');
    }
  }

  /** Loads a session and refuses it if it can no longer be played. */
  private async loadPlayableSession(gameUuid: string): Promise<GameSession> {
    const session =
      await this.gameSessionsService.getGameSessionByUuid(gameUuid);
    if (!session.isOpen) {
      throw new BadRequestException(`Game session ${gameUuid} is closed`);
    }
    return session;
  }

  /** Issues the seat's token and returns the join result. */
  private async seatPlayer(
    session: GameSession,
    participantId: string,
    holderId?: string,
  ): Promise<JoinResult> {
    if (holderId) {
      const row = session.participants
        .getItems()
        .find((p) => p.uuid === participantId);
      if (row && !row.claimedBy) {
        await this.gameSessionsService.claim(row, holderId);
      }
    }
    await this.codes.touch(session.uuid);
    await this.noteActivity(session);

    return {
      snapshot: await this.finalize(
        this.runtime.snapshot(session.uuid),
        session,
      ),
      token: this.tokens.issue({ gameUuid: session.uuid, participantId }),
      participantId,
    };
  }

  private async noteActivity(session: GameSession): Promise<void> {
    await this.gameSessionsService.touch(session);
  }

  private async persistBalances(
    gameUuid: string,
    session: GameSession,
  ): Promise<void> {
    const snapshot = this.runtime.snapshot(gameUuid);
    await this.gameSessionsService.syncBalances(session, balancesOf(snapshot));
    await this.codes.touch(gameUuid);
  }

  /** Drops the runtime cache and the sockets; the rows keep the truth. */
  private async teardown(gameUuid: string): Promise<void> {
    await this.lifecycle.cancelRoomClosure(gameUuid);
    await this.codes.revoke(gameUuid);
    this.runtime.disposeSession(gameUuid);
    this.presence.closeRoom(gameUuid);
  }

  /**
   * Completes a runtime snapshot with everything the runtime cannot know: the
   * live code, the session name, the resolved seat names and avatars, and who
   * is actually connected. `controller` is dropped here — this shape goes to
   * every socket in the room.
   */
  private async finalize(
    snapshot: RuntimeSnapshot,
    session: GameSession,
  ): Promise<GameSnapshot> {
    const config = gameConfigSchema.parse(session.config);
    const connected = this.presence.connectedParticipants(session.uuid);
    const participants = await Promise.all(
      snapshot.participants.map((p) =>
        this.resolveParticipant(p, config, connected),
      ),
    );

    return {
      ...snapshot,
      name: session.name,
      status: session.status,
      joinCode: await this.codes.codeFor(session.uuid),
      participants,
    };
  }

  private async resolveParticipant(
    p: RawParticipantSnapshot,
    config: GameConfig,
    connected: ReadonlySet<string>,
  ): Promise<ParticipantSnapshot> {
    // Anonymous holders are prefixed, so only a real uuid hits the database.
    const account =
      p.controller && z.uuid().safeParse(p.controller).success
        ? await this.usersService.findUserByUuid(p.controller)
        : null;

    return {
      id: p.id,
      role: p.role,
      balance: p.balance,
      seatIndex: p.seatIndex,
      status: p.status,
      claimed: p.controller !== null,
      connected: connected.has(p.id),
      displayName:
        p.displayNameOverride ??
        account?.displayName ??
        account?.username ??
        config.seating.seats[p.seatIndex]?.displayName ??
        `Seat ${p.seatIndex + 1}`,
      photoUrl: account
        ? await this.usersService.buildAvatarUrl(account)
        : null,
    };
  }
}

function seatInits(rows: GameParticipant[]): SeatInit[] {
  return rows.map((p) => ({
    id: p.uuid,
    seatIndex: p.seatIndex,
    role: p.role,
    displayNameOverride: p.displayName,
    balance: p.balance,
    controller: p.claimedBy,
  }));
}

function balancesOf(snapshot: RuntimeSnapshot): Map<string, number> {
  return new Map(snapshot.participants.map((p) => [p.id, p.balance]));
}
