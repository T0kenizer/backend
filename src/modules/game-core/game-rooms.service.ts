import type { GameParticipant } from '@entities/game/game-participant.entity';
import type { GameSession } from '@entities/game/game-session.entity';
import { CreateRequestContext, MikroORM } from '@mikro-orm/core';
import { GameCodesService } from '@modules/game-core/game-codes.service';
import * as Constants from '@modules/game-core/game-core.constants';
import type { SeatInit } from '@modules/game-core/game-core.types';
import { GameLifecycleService } from '@modules/game-core/game-lifecycle.service';
import { GAME_MODES, defaultConfigFor } from '@modules/game-core/game-modes';
import { GamePresenceService } from '@modules/game-core/game-presence.service';
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
import {
  MAX_SEATS,
  MIN_SEATS,
} from '@tokenizer/shared/constants/games.constants';
import { DELETED_USER_CLAIM } from '@tokenizer/shared/constants/users.constants';
import { gameConfigSchema } from '@tokenizer/shared/schemas';
import {
  GameServerEvent,
  GameSessionStatus,
  Plan,
  type ClaimSeatData,
  type CreateGameSessionData,
  type GameConfig,
  type GameModeDescriptor,
  type GameResolution,
  type GameSnapshot,
  type HandResolution,
  type ParticipantSnapshot,
  type PotAward,
  type PublicRoomView,
  type RoundResolution,
  type SubmitActionData,
  type UpdateSeatData,
} from '@tokenizer/shared/types';
import { canUseMode, maxSeatsFor } from '@tokenizer/shared/utils/plans.utils';
import { randomUUID } from 'crypto';
import { z } from 'zod';

export interface JoinResult {
  snapshot: GameSnapshot;
  token: string;
  participantId: string;
}

@Injectable()
export class GameRoomsService {
  private readonly logger = new Logger(GameRoomsService.name);

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

  @CreateRequestContext()
  async createGame(
    ownerUuid: string,
    data: CreateGameSessionData,
  ): Promise<JoinResult> {
    if (!z.uuid().safeParse(ownerUuid).success) {
      throw new BadRequestException(
        'Creating a game requires an authenticated user uuid',
      );
    }

    const owner = await this.usersService.getUserByUuid(ownerUuid);

    if (!canUseMode(owner.plan, data.mode)) {
      throw new ForbiddenException(
        `Your plan does not include ${data.mode.toLowerCase()}`,
      );
    }

    const defaults = defaultConfigFor(data.mode);
    const gameConfig: GameConfig = gameConfigSchema.parse(
      data.config ??
        (data.seats
          ? { ...defaults, seating: { ...defaults.seating, seats: data.seats } }
          : defaults),
    );

    this.assertSeatBounds(gameConfig.seating.seats.length);

    if (gameConfig.seating.seats.length > maxSeatsFor(owner.plan)) {
      throw new ForbiddenException(
        `Your plan allows at most ${maxSeatsFor(owner.plan)} seats`,
      );
    }

    const { session, participants } = await this.gameSessionsService.create(
      owner,
      gameConfig,
      data.name,
    );

    this.runtime.registerSession(
      session.uuid,
      gameConfig,
      owner.uuid,
      seatInits(participants),
    );
    await this.codes.issue(session.uuid);

    const { participantId } = this.runtime.claimSeat(session.uuid, {
      holderId: owner.uuid,
      seatIndex: 0,
    });
    return this.seatPlayer(session, participantId, owner.uuid);
  }

  listModes(): readonly GameModeDescriptor[] {
    return GAME_MODES;
  }

  async resolveCode(code: string): Promise<Nullable<string>> {
    return this.codes.resolve(code);
  }

  @CreateRequestContext()
  async publicRoomView(gameUuid: string): Promise<PublicRoomView> {
    const session =
      await this.gameSessionsService.getGameSessionByUuid(gameUuid);
    const seats = session.participants.getItems();

    return {
      name: session.name,
      mode: gameConfigSchema.parse(session.config).mode,
      status: session.status,
      playerCount: seats.filter((p) => p.claimedBy !== null).length,
      seatCount: seats.length,
    };
  }

  @CreateRequestContext()
  async ensureRoomOpen(gameUuid: string): Promise<GameSnapshot> {
    const session = await this.loadPlayableSession(gameUuid);
    const config = gameConfigSchema.parse(session.config);

    if (!this.runtime.hasSession(gameUuid)) {
      this.runtime.registerSession(
        session.uuid,
        config,
        session.owner?.uuid ?? DELETED_USER_CLAIM,
        seatInits(session.participants.getItems()),
      );
      if (!(await this.codes.codeFor(gameUuid)))
        await this.codes.issue(gameUuid);

      this.logger.log(`Room ${gameUuid} opened from persisted session`);
    }

    return this.finalize(this.runtime.snapshot(gameUuid), session);
  }

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

    const holderId = userUuid ?? `anon:${randomUUID()}`;
    const existing = this.runtime.findSeatByHolder(gameUuid, holderId);
    if (existing) return this.seatPlayer(session, existing, holderId);

    const seatIndex = data.openExtraSeat
      ? this.runtime.seatIndexOf(gameUuid, await this.openSeatFor(session))
      : data.seatIndex;

    const { participantId } = this.runtime.claimSeat(gameUuid, {
      holderId,
      displayName: data.displayName,
      seatIndex,
    });

    const row = session.participants
      .getItems()
      .find((p) => p.uuid === participantId);
    if (row) {
      await this.gameSessionsService.claim(row, holderId, data.displayName);
    }

    return this.seatPlayer(session, participantId, holderId);
  }

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

  private assertSeatBounds(seatCount: number): void {
    if (seatCount < MIN_SEATS) {
      throw new BadRequestException(
        `A table needs at least ${MIN_SEATS} seats`,
      );
    }
    if (seatCount > MAX_SEATS) {
      throw new BadRequestException(
        `A table cannot hold more than ${MAX_SEATS} seats`,
      );
    }
  }

  @CreateRequestContext()
  private async openSeatFor(session: GameSession): Promise<string> {
    const gameUuid = session.uuid;
    this.runtime.assertCanAddSeat(gameUuid);

    const seatCount = session.participants.getItems().length;
    this.assertSeatBounds(seatCount + 1);

    const allowed = maxSeatsFor(session.owner?.plan ?? Plan.Free);
    if (seatCount >= allowed) {
      throw new ForbiddenException(
        `This table cannot grow past ${allowed} seats`,
      );
    }

    const config = gameConfigSchema.parse(session.config);
    const seatIndex = seatCount;
    const row = await this.gameSessionsService.addParticipant(
      session,
      seatIndex,
      `Seat ${seatIndex + 1}`,
      config.seating.defaultInitialBalance,
    );

    this.runtime.addSeat(gameUuid, {
      id: row.uuid,
      displayName: row.displayName ?? `Seat ${seatIndex + 1}`,
      initialBalance: row.initialBalance,
    });

    return row.uuid;
  }

  @CreateRequestContext()
  async startHand(
    gameUuid: string,
    participantId: string,
  ): Promise<{ snapshot: GameSnapshot; resolution?: HandResolution }> {
    await this.ensureRoomOpen(gameUuid);
    this.assertHost(gameUuid, participantId);

    const result = this.runtime.startHand(gameUuid);
    const session = await this.loadPlayableSession(gameUuid);
    await this.gameSessionsService.setStatus(
      session,
      GameSessionStatus.Running,
    );
    if (result.resolution) await this.persistBalances(gameUuid, session);
    await this.codes.touch(gameUuid);

    return {
      ...result,
      snapshot: await this.finalize(result.snapshot, session),
    };
  }

  @CreateRequestContext()
  async startRound(
    gameUuid: string,
    participantId: string,
  ): Promise<GameSnapshot> {
    await this.ensureRoomOpen(gameUuid);
    this.assertHost(gameUuid, participantId);

    const { snapshot } = this.runtime.startRound(gameUuid);
    const session = await this.loadPlayableSession(gameUuid);
    await this.gameSessionsService.setStatus(
      session,
      GameSessionStatus.Running,
    );
    await this.persistBalances(gameUuid, session);
    await this.codes.touch(gameUuid);

    return this.finalize(snapshot, session);
  }

  @CreateRequestContext()
  async submitAction(
    gameUuid: string,
    participantId: string,
    data: SubmitActionData,
  ): Promise<{ snapshot: GameSnapshot; resolution?: GameResolution }> {
    await this.ensureRoomOpen(gameUuid);
    const result = this.runtime.submitAction(
      gameUuid,
      participantId,
      data,
      (id) => this.presence.isParticipantConnected(gameUuid, id),
    );

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

  @CreateRequestContext()
  async declareWinners(
    gameUuid: string,
    participantId: string,
    awards: PotAward[],
  ): Promise<{ snapshot: GameSnapshot; resolution: HandResolution }> {
    await this.ensureRoomOpen(gameUuid);
    this.assertHost(gameUuid, participantId);

    const result = this.runtime.declareWinners(gameUuid, awards);
    const session = await this.loadPlayableSession(gameUuid);
    await this.persistBalances(gameUuid, session);

    return {
      ...result,
      snapshot: await this.finalize(result.snapshot, session),
    };
  }

  @CreateRequestContext()
  async resolveRound(
    gameUuid: string,
    participantId: string,
    winnerParticipantIds: string[] = [],
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

    await this.lifecycle.cancelRoomRelease(gameUuid);
    await this.codes.revoke(gameUuid);
    await this.lifecycle.scheduleRoomTeardown(gameUuid);

    this.logger.log(`Session ${gameUuid} ended by its host`);
    return this.finalize(snapshot, session);
  }

  async teardownClosedRoom(gameUuid: string): Promise<void> {
    if (!this.runtime.hasSession(gameUuid)) return;
    await this.teardown(gameUuid);
    this.logger.log(`Room for the ended session ${gameUuid} reclaimed`);
  }

  @CreateRequestContext()
  async releaseEmptyRoom(gameUuid: string): Promise<void> {
    let session: GameSession;
    try {
      session = await this.gameSessionsService.getGameSessionByUuid(gameUuid);
    } catch {
      await this.dropRoom(gameUuid);
      return;
    }

    if (this.runtime.hasSession(gameUuid)) {
      await this.gameSessionsService.syncBalances(
        session,
        balancesOf(this.runtime.snapshot(gameUuid)),
      );
    }

    await this.dropRoom(gameUuid);
    this.logger.log(
      `Room ${gameUuid} released after an empty grace period; the session can be resumed`,
    );
  }

  @CreateRequestContext()
  async announceDeparture(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.broadcastPresence(
      gameUuid,
      participantId,
      GameServerEvent.ParticipantLeft,
    );
  }

  private async broadcastPresence(
    gameUuid: string,
    participantId: string,
    event: GameServerEvent,
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

  @CreateRequestContext()
  async sweepIdleRooms(): Promise<number> {
    const threshold = new Date(
      Date.now() - Constants.STALE_SESSION_THRESHOLD_MS,
    );

    let released = 0;
    for (const gameUuid of this.runtime.sessionIds()) {
      // A room can be idle on paper and busy in fact (a long think between
      // actions); presence has the last word, as everywhere else.
      if (!this.presence.isRoomEmpty(gameUuid)) continue;

      let session: Nullable<GameSession> = null;
      try {
        session = await this.gameSessionsService.getGameSessionByUuid(gameUuid);
      } catch {
        // The row is gone; the room it left behind holds nothing open.
      }
      if (session && session.lastActivityAt > threshold) continue;

      if (session?.isOpen) await this.releaseEmptyRoom(gameUuid);
      else await this.teardown(gameUuid);
      released++;
    }

    if (released) {
      this.logger.warn(
        `Idle sweep reclaimed ${released} room(s) empty for over ` +
          `${Constants.STALE_SESSION_THRESHOLD_MS / 60_000}min`,
      );
    }
    return released;
  }

  async onPlayerConnected(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.lifecycle.cancelRoomRelease(gameUuid);
    await this.lifecycle.cancelPlayerDeparture(gameUuid, participantId);
    await this.codes.touch(gameUuid);
  }

  async onPlayerDisconnected(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    if (this.runtime.isFinished(gameUuid)) {
      if (this.presence.isRoomEmpty(gameUuid)) {
        await this.lifecycle.cancelRoomTeardown(gameUuid);
        await this.teardownClosedRoom(gameUuid);
      }
      return;
    }

    await this.lifecycle.schedulePlayerDeparture(gameUuid, participantId);
    if (this.presence.isRoomEmpty(gameUuid)) {
      await this.lifecycle.scheduleRoomRelease(gameUuid);
    }
    await this.announceDisconnect(gameUuid, participantId);
  }

  @CreateRequestContext()
  async announceDisconnect(
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    await this.broadcastPresence(
      gameUuid,
      participantId,
      GameServerEvent.ParticipantDisconnected,
    );
  }

  private assertHost(gameUuid: string, participantId: string): void {
    if (!this.runtime.isHost(gameUuid, participantId)) {
      throw new ForbiddenException('Only the host can perform this action');
    }
  }

  private async loadPlayableSession(gameUuid: string): Promise<GameSession> {
    const session =
      await this.gameSessionsService.getGameSessionByUuid(gameUuid);
    if (!session.isOpen) {
      throw new BadRequestException(`Game session ${gameUuid} is closed`);
    }
    return session;
  }

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

  private async dropRoom(gameUuid: string): Promise<void> {
    await this.lifecycle.cancelRoomRelease(gameUuid);
    await this.lifecycle.cancelRoomTeardown(gameUuid);
    this.runtime.disposeSession(gameUuid);
    this.presence.closeRoom(gameUuid);
  }

  private async teardown(gameUuid: string): Promise<void> {
    await this.dropRoom(gameUuid);
    await this.codes.revoke(gameUuid);
  }

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
      canAddSeat:
        this.runtime.canAddSeat(session.uuid) &&
        participants.length < MAX_SEATS &&
        participants.length < maxSeatsFor(session.owner?.plan ?? Plan.Free),
    };
  }

  private async resolveParticipant(
    p: RawParticipantSnapshot,
    config: GameConfig,
    connected: ReadonlySet<string>,
  ): Promise<ParticipantSnapshot> {
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
        (p.controller === DELETED_USER_CLAIM ? DELETED_USER_CLAIM : null) ??
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
