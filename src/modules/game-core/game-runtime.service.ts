import type {
  ClaimParams,
  SeatInit,
  UpdateSeatParams,
} from '@modules/game-core/game-core.types';
import {
  serializeSession,
  type RuntimeSnapshot,
} from '@modules/game-core/game-runtime.snapshot';
import { GameSession } from '@modules/game-core/runtime/game-session';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EndResolution,
  RoundStatus,
  type GameConfig,
  type RoundResolution,
  type SubmitActionData,
} from '@tokenizer/shared/types';

/**
 * The in-memory game runtime. Holds the live aggregates, orchestrates their
 * lifecycle and evaluates end conditions. No transport and no persistence:
 * `GameRoomsService` maps the aggregates onto the database rows.
 */
@Injectable()
export class GameRuntimeService {
  private readonly logger = new Logger(GameRuntimeService.name);
  private readonly sessions = new Map<string, GameSession>();

  /**
   * Registers a runtime session under the persisted `GameSession` uuid — the
   * in-memory aggregate, the Socket.IO room and the database row all share the
   * same identifier — building its seats from the persisted rows.
   */
  registerSession(
    gameId: string,
    config: GameConfig,
    ownerUuid: string,
    seats: SeatInit[],
  ): RuntimeSnapshot {
    if (this.sessions.has(gameId)) {
      throw new BadRequestException(`Game session ${gameId} is already open`);
    }
    const session = new GameSession(gameId, config, ownerUuid, seats);
    this.sessions.set(session.id, session);
    this.logger.log(`Opened game session ${session.id}`);
    return this.snapshot(session.id);
  }

  hasSession(gameId: string): boolean {
    return this.sessions.has(gameId);
  }

  /** Drops the in-memory aggregate; persisted state is untouched. */
  disposeSession(gameId: string): void {
    this.sessions.delete(gameId);
  }

  snapshot(gameId: string): RuntimeSnapshot {
    return serializeSession(gameId, this.getSessionOrThrow(gameId));
  }

  /**
   * Claims a seat for an external identity. Idempotent for an identity that
   * already holds one (survives reconnects).
   */
  claimSeat(
    gameId: string,
    params: ClaimParams,
  ): { snapshot: RuntimeSnapshot; participantId: string } {
    const session = this.getSessionOrThrow(gameId);
    const seat = session.claimSeat(params);
    this.logger.log(
      `Seat ${seat.seatIndex} of ${gameId} claimed by ${params.externalId}`,
    );
    return { snapshot: this.snapshot(gameId), participantId: seat.id };
  }

  /** Renames/re-photos the seat held by the caller's external identity. */
  updateSeat(
    gameId: string,
    params: UpdateSeatParams,
  ): { snapshot: RuntimeSnapshot; participantId: string } {
    const session = this.getSessionOrThrow(gameId);
    const seat = session.updateSeat(params);
    return { snapshot: this.snapshot(gameId), participantId: seat.id };
  }

  startRound(gameId: string): RuntimeSnapshot {
    const session = this.getSessionOrThrow(gameId);
    const round = session.startRound();
    round.applyForcedBets();
    this.logger.log(`Round ${round.id} started in ${gameId}`);
    return this.snapshot(gameId);
  }

  /**
   * Applies an action, then evaluates automatic end conditions. Returns the
   * fresh snapshot plus a resolution descriptor when the round terminated. With
   * no `targetParticipantId`, acts on the caller's own seat; the host may
   * target an unclaimed seat instead, acting on its behalf.
   */
  submitAction(
    gameId: string,
    params: SubmitActionData,
  ): { snapshot: RuntimeSnapshot; resolution?: RoundResolution } {
    const session = this.getSessionOrThrow(gameId);
    if (!session.currentRound) {
      throw new BadRequestException('No round is in progress');
    }

    const participant = session.resolveActingParticipant(
      params.externalId,
      params.targetParticipantId,
    );
    session.currentRound.submitAction({
      participantId: participant.id,
      definitionId: params.definitionId,
      amount: params.amount,
    });

    const resolution = this.evaluateEndConditions(gameId);
    return { snapshot: this.snapshot(gameId), resolution };
  }

  /** Host-driven termination for MANUAL_HOST end policies. */
  resolveRound(
    gameId: string,
    winnerExternalIds: string[] = [],
  ): { snapshot: RuntimeSnapshot; resolution: RoundResolution } {
    const session = this.getSessionOrThrow(gameId);
    const round = session.currentRound;
    if (!round || round.status !== RoundStatus.InProgress) {
      throw new BadRequestException('No active round to resolve');
    }

    const winners = winnerExternalIds.length
      ? winnerExternalIds.map((ext) => session.resolveActingParticipant(ext).id)
      : round.contenders().map((p) => p.id);

    round.resolve(winners);
    const resolution = this.buildResolution(round.id, 'MANUAL_HOST', winners);
    return { snapshot: this.snapshot(gameId), resolution };
  }

  closeSession(gameId: string): RuntimeSnapshot {
    const session = this.getSessionOrThrow(gameId);
    session.closeSession();
    const snapshot = this.snapshot(gameId);
    this.logger.log(`Closed game session ${gameId}`);
    return snapshot;
  }

  /** Whether the external identity is the session's owner (the host). */
  isHost(gameId: string, externalId: string): boolean {
    const session = this.getSessionOrThrow(gameId);
    return session.ownerUuid === externalId;
  }

  private getSessionOrThrow(gameId: string): GameSession {
    const session = this.sessions.get(gameId);
    if (!session)
      throw new NotFoundException(`Game session ${gameId} not found`);
    return session;
  }

  /**
   * V0 automatic end condition: LAST_PLAYER_STANDING. When a single contender
   * remains, the round auto-resolves and the pot is awarded to the survivor.
   */
  private evaluateEndConditions(gameId: string): Optional<RoundResolution> {
    const session = this.getSessionOrThrow(gameId);
    const round = session.currentRound;
    if (!round || round.status !== RoundStatus.InProgress) return undefined;

    const { endPolicy } = session.config;
    if (endPolicy.resolution !== EndResolution.Automatic) return undefined;

    const hasLastStanding = endPolicy.conditions.some(
      (c) => c.type === 'LAST_PLAYER_STANDING',
    );
    if (!hasLastStanding) return undefined;

    const contenders = round.contenders();
    if (contenders.length > 1) return undefined;

    const winners = contenders.map((p) => p.id);
    round.resolve(winners);
    return this.buildResolution(round.id, 'LAST_PLAYER_STANDING', winners);
  }

  private buildResolution(
    roundId: string,
    reason: RoundResolution['reason'],
    winners: string[],
  ): RoundResolution {
    this.logger.log(`Round ${roundId} resolved (${reason})`);
    return { roundId, reason, winners };
  }
}
