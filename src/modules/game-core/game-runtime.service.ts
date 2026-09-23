import { FreeSession } from '@modules/game-core/free/free-session';
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
import { PokerSession } from '@modules/game-core/poker/poker-session';
import { GameSession } from '@modules/game-core/runtime/game-session';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GameMode,
  GameSessionStatus,
  HandStatus,
  type GameConfig,
  type GameResolution,
  type HandResolution,
  type PotAward,
  type RoundResolution,
  type SubmitActionData,
} from '@tokenizer/shared/types';

/**
 * The in-memory game runtime. Holds the live aggregates and their lifecycle; no
 * transport and no persistence. The rules themselves live a layer down, in each
 * mode's own runtime (`poker/`, `free/`), which is where they belong: this
 * service neither knows nor decides what a legal move is.
 *
 * What it does know is which mode a session is: the aggregate is built from the
 * config's discriminator, and every call that is a mode's own asks for that
 * mode's session back rather than testing a flag inline.
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
    const session =
      config.mode === GameMode.Poker
        ? new PokerSession(gameId, config, ownerUuid, seats)
        : new FreeSession(gameId, config, ownerUuid, seats);

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

  /**
   * Whether the table is over. Answered off the aggregate rather than the row
   * because the callers are socket-lifecycle ones: they run per disconnect, and
   * a database read per dropped socket would be a query for every refresh.
   */
  isFinished(gameId: string): boolean {
    return this.sessions.get(gameId)?.status === GameSessionStatus.Finished;
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

  /** Where a seat sits at the table, by its id. */
  seatIndexOf(gameId: string, participantId: string): number {
    return this.getSessionOrThrow(gameId).seatOrThrow(participantId).seatIndex;
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

  /** Poker: deals a hand — the button moves, the antes and blinds go in. */
  startHand(gameId: string): {
    snapshot: RuntimeSnapshot;
    resolution?: HandResolution;
  } {
    const session = this.pokerSessionOrThrow(gameId);
    const hand = session.startHand();
    this.logger.log(`Hand ${hand.handNumber} dealt in ${gameId}`);

    return {
      snapshot: this.snapshot(gameId),
      // Antes and blinds alone can put everybody all-in, which settles the
      // hand before anybody is asked for a move.
      resolution: hand.resolution ?? undefined,
    };
  }

  /** Free mode: opens a round and takes the forced bets the host declared. */
  startRound(gameId: string): { snapshot: RuntimeSnapshot } {
    const session = this.freeSessionOrThrow(gameId);
    const round = session.startRound();
    this.logger.log(`Round ${round.id} started in ${gameId}`);
    return { snapshot: this.snapshot(gameId) };
  }

  /**
   * Plays a move. The deal decides whether it is legal, what it costs and
   * whether it ends anything; this only says whose seat it lands on and which
   * vocabulary the payload has to be in. With no `targetParticipantId`, the
   * seat is the caller's own; the host may target an unclaimed seat instead,
   * acting on its behalf.
   */
  submitAction(
    gameId: string,
    callerParticipantId: string,
    params: SubmitActionData,
  ): { snapshot: RuntimeSnapshot; resolution?: GameResolution } {
    const session = this.getSessionOrThrow(gameId);
    const participant = session.resolveActingParticipant(
      callerParticipantId,
      params.targetParticipantId,
    );

    if (session instanceof PokerSession) {
      if (params.action === undefined) {
        throw new BadRequestException(
          'This table plays poker — name a poker action, not a catalog entry',
        );
      }
      const hand = session.currentHand;
      if (!hand) throw new BadRequestException('No hand is in progress');

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

    const free = session as FreeSession;
    if (params.definitionId === undefined) {
      throw new BadRequestException(
        'This table plays its own rules — name an action from its catalog',
      );
    }

    const resolution = free.submitAction(
      participant,
      params.definitionId,
      params.amount,
    );
    if (resolution) {
      this.logger.log(
        `Round ${resolution.roundId} of ${gameId} resolved (${resolution.reason})`,
      );
    }
    return { snapshot: this.snapshot(gameId), resolution };
  }

  /**
   * Poker: settles a showdown from the table's own verdict. The app holds the
   * chips, not the cards: who won is the one thing it has to be told.
   */
  declareWinners(
    gameId: string,
    awards: PotAward[],
  ): { snapshot: RuntimeSnapshot; resolution: HandResolution } {
    const session = this.pokerSessionOrThrow(gameId);
    const hand = session.currentHand;
    if (!hand || hand.status === HandStatus.Settled) {
      throw new BadRequestException('No hand is waiting on a showdown');
    }

    const resolution = hand.declareWinners(awards);
    this.logger.log(`Hand ${hand.handNumber} of ${gameId} settled (showdown)`);
    return { snapshot: this.snapshot(gameId), resolution };
  }

  /** Free mode: settles the open round on the winners the table names. */
  resolveRound(
    gameId: string,
    winnerParticipantIds: string[] = [],
  ): { snapshot: RuntimeSnapshot; resolution: RoundResolution } {
    const session = this.freeSessionOrThrow(gameId);
    const resolution = session.resolveRound(winnerParticipantIds);
    this.logger.log(
      `Round ${resolution.roundId} of ${gameId} resolved (${resolution.reason})`,
    );
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

  /**
   * The session, refused unless it is a poker table.
   *
   * A 400 rather than a 404: the room exists, it is simply not playing the game
   * the caller is speaking — which is a client calling the wrong route, not a
   * missing session.
   */
  private pokerSessionOrThrow(gameId: string): PokerSession {
    const session = this.getSessionOrThrow(gameId);
    if (!(session instanceof PokerSession)) {
      throw new BadRequestException('This table is not playing poker');
    }
    return session;
  }

  /** {@link pokerSessionOrThrow}, for the free table's own calls. */
  private freeSessionOrThrow(gameId: string): FreeSession {
    const session = this.getSessionOrThrow(gameId);
    if (!(session instanceof FreeSession)) {
      throw new BadRequestException('This table is not playing its own rules');
    }
    return session;
  }
}
