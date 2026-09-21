import type {
  ClaimParams,
  SeatInit,
  UpdateSeatParams,
} from '@modules/game-core/game-core.types';
import { Participant } from '@modules/game-core/runtime/participant';
import { Round } from '@modules/game-core/runtime/round';
import { BadRequestException } from '@nestjs/common';
import {
  GameSessionStatus,
  ParticipantRole,
  ParticipantStatus,
  RoundStatus,
  type GameConfig,
} from '@tokenizer/shared/types';

export class GameSession {
  readonly id: string;
  status: GameSessionStatus;
  /** Immutable once the session is created */
  readonly config: GameConfig;
  /**
   * The session creator's identity: a companion, not a seated player. Holds
   * host permissions (start/resolve/close, proxying unclaimed seats) regardless
   * of whether they ever claim a seat themselves.
   */
  readonly ownerUuid: string;
  /** Every seat of the session, keyed by participant id. */
  readonly participants: Map<string, Participant>;
  currentRound?: Round;

  /**
   * Seats are declared up front: the aggregate is always built from the full
   * seat list (fresh rows on creation, hydrated rows when a room re-opens).
   */
  constructor(
    id: string,
    config: GameConfig,
    ownerUuid: string,
    seats: SeatInit[],
  ) {
    this.id = id;
    this.config = config;
    this.ownerUuid = ownerUuid;
    this.status = GameSessionStatus.Lobby;
    this.participants = new Map(
      seats.map((seat) => [seat.id, new Participant(seat)]),
    );
  }

  /** Every seat, ordered by seat index. */
  get seats(): Participant[] {
    return [...this.participants.values()].sort(
      (a, b) => a.seatIndex - b.seatIndex,
    );
  }

  /**
   * Occupies a seat. Idempotent for an external identity that already holds one
   * (reconnects). Free seats can be claimed until the session finishes —
   * between rounds included — unless the config locks them once the game has
   * started (`seating.allowMidGameClaims: false`).
   */
  claimSeat(params: ClaimParams): Participant {
    if (this.status === GameSessionStatus.Finished) {
      throw new BadRequestException('Session is finished');
    }

    const seats = this.seats;
    // Reconnections first: a held seat survives the mid-game lock.
    const held = seats.find((p) => p.controller === params.holderId);
    if (held) return held;

    if (
      this.status === GameSessionStatus.Running &&
      !this.config.seating.allowMidGameClaims
    ) {
      throw new BadRequestException(
        'Seat claims are locked once the game has started',
      );
    }

    let seat: Optional<Participant>;
    if (params.seatIndex !== undefined) {
      seat = seats.find((p) => p.seatIndex === params.seatIndex);
      if (!seat) {
        throw new BadRequestException(
          `Seat ${params.seatIndex} does not exist`,
        );
      }
      if (seat.claimed) {
        throw new BadRequestException(
          `Seat ${params.seatIndex} is already claimed`,
        );
      }
    } else {
      // Never hand out the host seat by default: it carries the authority to
      // start, resolve and close the game, and it belongs to whoever created
      // it. Taking it has to be deliberate.
      seat = seats.find((p) => !p.claimed && p.role !== ParticipantRole.Host);
      if (!seat) {
        throw new BadRequestException('No free seat left');
      }
    }

    seat.claim(params.holderId, params.displayName);
    return seat;
  }

  /** Renames the seat the caller holds. */
  updateSeat(params: UpdateSeatParams): Participant {
    const seat = this.seatOrThrow(params.participantId);
    seat.update(params.displayName);
    return seat;
  }

  /** The seat with this id, or a 400 naming it. */
  seatOrThrow(participantId: string): Participant {
    const seat = this.participants.get(participantId);
    if (!seat) {
      throw new BadRequestException(`Unknown participant "${participantId}"`);
    }
    return seat;
  }

  /** Whether a seat carries host authority. */
  isHost(participantId: string): boolean {
    return this.participants.get(participantId)?.role === ParticipantRole.Host;
  }

  /**
   * Resolves which seat an action/resolution acts on. With no target, it is the
   * caller's own seat — identified by the participant id their token carries,
   * so it cannot be another's. The host may instead target an unclaimed seat
   * and act on its behalf (a companion noting a table player's move); every
   * declared seat plays from round one, claimed or not.
   */
  resolveActingParticipant(
    callerParticipantId: string,
    targetParticipantId?: string,
  ): Participant {
    if (targetParticipantId === undefined) {
      return this.seatOrThrow(callerParticipantId);
    }

    if (!this.isHost(callerParticipantId)) {
      throw new BadRequestException(
        'Only the host can act on behalf of another seat',
      );
    }

    const seat = this.seatOrThrow(targetParticipantId);
    if (seat.claimed) {
      throw new BadRequestException(
        'The host can only act on behalf of an unclaimed seat',
      );
    }
    return seat;
  }

  startRound(): Round {
    if (this.status === GameSessionStatus.Finished) {
      throw new BadRequestException('Session is already finished');
    }
    if (
      this.currentRound !== undefined &&
      (this.currentRound.status === RoundStatus.Init ||
        this.currentRound.status === RoundStatus.InProgress)
    ) {
      throw new BadRequestException(
        'Resolve the current round before starting a new one',
      );
    }

    // Every declared seat is a real chair at the table — claimed or not, the
    // host notes moves for whoever hasn't claimed theirs yet. Only
    // eliminated seats stay out.
    const contenders = this.seats.filter(
      (p) => p.status !== ParticipantStatus.Eliminated,
    );
    if (contenders.length < 2) {
      throw new BadRequestException(
        'At least 2 non-eliminated seats are required',
      );
    }

    if (this.status === GameSessionStatus.Lobby) {
      this.status = GameSessionStatus.Running;
    }

    // Reset per-round state — FOLDED/WAITING revert to ACTIVE; ELIMINATED stays out
    for (const p of contenders) {
      if (
        p.status === ParticipantStatus.Folded ||
        p.status === ParticipantStatus.Waiting
      ) {
        p.status = ParticipantStatus.Active;
      }
    }

    const round = new Round(this.config, contenders);
    this.currentRound = round;
    return round;
  }

  closeSession(): void {
    this.currentRound?.resolve();
    this.status = GameSessionStatus.Finished;
  }
}
