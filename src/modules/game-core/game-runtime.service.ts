import type {
  AddSeatParams,
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
  HandStatus,
  type GameConfig,
  type HandResolution,
  type PotAward,
  type SubmitActionData,
} from '@tokenizer/shared/types';

/**
 * The in-memory game runtime. Holds the live aggregates and their lifecycle; no
 * transport and no persistence. The rules themselves live a layer down, in the
 * mode's own runtime (`poker/`), which is where they belong: this service
 * neither knows nor decides what a legal move is.
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
    this.logger.log(`Opened game session ${session.id} (${config.mode})`);
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
    this.logger.log(`Seat ${seat.seatIndex} of ${gameId} claimed`);
    return { snapshot: this.snapshot(gameId), participantId: seat.id };
  }

  /**
   * Opens a further seat at a full table. The row must already exist — the
   * runtime and the database share seat ids.
   */
  addSeat(
    gameId: string,
    params: AddSeatParams,
  ): { snapshot: RuntimeSnapshot; participantId: string } {
    const session = this.getSessionOrThrow(gameId);
    const seat = session.addSeat(params);
    this.logger.log(`Seat ${seat.seatIndex} added to ${gameId}`);
    return { snapshot: this.snapshot(gameId), participantId: seat.id };
  }

  /**
   * Whether the seating rules permit another seat right now. The plan cap is
   * the caller's to apply — the runtime has no idea who owns the session.
   */
  canAddSeat(gameId: string): boolean {
    return this.getSessionOrThrow(gameId).canAddSeat;
  }

  /** {@link canAddSeat}, as a 400 naming the condition that failed. */
  assertCanAddSeat(gameId: string): void {
    this.getSessionOrThrow(gameId).assertCanAddSeat();
  }

  /** The seat a holder identity already occupies, if any. */
  findSeatByHolder(gameId: string, holderId: string): Optional<string> {
    return this.getSessionOrThrow(gameId).seats.find(
      (p) => p.controller === holderId,
    )?.id;
  }

  /** Renames the seat the caller's token binds them to. */
  updateSeat(
    gameId: string,
    params: UpdateSeatParams,
  ): { snapshot: RuntimeSnapshot; participantId: string } {
    const session = this.getSessionOrThrow(gameId);
    const seat = session.updateSeat(params);
    return { snapshot: this.snapshot(gameId), participantId: seat.id };
  }

  /** Deals a hand: the button moves, the antes and blinds go in. */
  startHand(gameId: string): {
    snapshot: RuntimeSnapshot;
    resolution?: HandResolution;
  } {
    const session = this.getSessionOrThrow(gameId);
    const hand = session.startHand();
    this.logger.log(`Hand ${hand.handNumber} dealt in ${gameId}`);

    return {
      snapshot: this.snapshot(gameId),
      // Antes and blinds alone can put everybody all-in, which settles the
      // hand before anybody is asked for a move.
      resolution: hand.resolution ?? undefined,
    };
  }

  /**
   * Plays a move. The hand decides whether it is legal, what it costs and
   * whether it ends anything; this only says whose seat it lands on. With no
   * `targetParticipantId`, that is the caller's own; the host may target an
   * unclaimed seat instead, acting on its behalf.
   */
  submitAction(
    gameId: string,
    callerParticipantId: string,
    params: SubmitActionData,
  ): { snapshot: RuntimeSnapshot; resolution?: HandResolution } {
    const session = this.getSessionOrThrow(gameId);
    const hand = session.currentHand;
    if (!hand) throw new BadRequestException('No hand is in progress');

    const participant = session.resolveActingParticipant(
      callerParticipantId,
      params.targetParticipantId,
    );
    hand.submitAction(participant, params.action, params.amount);

    if (hand.resolution) {
      this.logger.log(
        `Hand ${hand.handNumber} of ${gameId} settled (${hand.resolution.reason})`,
      );
    }

    return {
      snapshot: this.snapshot(gameId),
      resolution: hand.resolution ?? undefined,
    };
  }

  /**
   * Settles a showdown from the table's own verdict. The app holds the chips,
   * not the cards: who won is the one thing it has to be told.
   */
  declareWinners(
    gameId: string,
    awards: PotAward[],
  ): { snapshot: RuntimeSnapshot; resolution: HandResolution } {
    const session = this.getSessionOrThrow(gameId);
    const hand = session.currentHand;
    if (!hand || hand.status === HandStatus.Settled) {
      throw new BadRequestException('No hand is waiting on a showdown');
    }

    const resolution = hand.declareWinners(awards);
    this.logger.log(`Hand ${hand.handNumber} of ${gameId} settled (showdown)`);
    return { snapshot: this.snapshot(gameId), resolution };
  }

  closeSession(gameId: string): RuntimeSnapshot {
    const session = this.getSessionOrThrow(gameId);
    session.closeSession();
    const snapshot = this.snapshot(gameId);
    this.logger.log(`Closed game session ${gameId}`);
    return snapshot;
  }

  /** Whether the seat carries host authority. */
  isHost(gameId: string, participantId: string): boolean {
    return this.getSessionOrThrow(gameId).isHost(participantId);
  }

  private getSessionOrThrow(gameId: string): GameSession {
    const session = this.sessions.get(gameId);
    if (!session)
      throw new NotFoundException(`Game session ${gameId} not found`);
    return session;
  }
}
