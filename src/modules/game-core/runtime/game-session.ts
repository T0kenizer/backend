import type {
  AddSeatParams,
  ClaimParams,
  SeatInit,
  UpdateSeatParams,
} from '@modules/game-core/game-core.types';
import { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import {
  GameSessionStatus,
  ParticipantRole,
  type GameConfig,
} from '@tokenizer/shared/types';

/**
 * A table, minus the game played at it.
 *
 * Everything here is true of any mode: seats are declared up front, a seat is
 * claimed by exactly one identity, the host may open another chair once the
 * table is full, and host authority rides on the seat rather than on whoever
 * holds it. None of it depends on whether the next deal is a poker hand or a
 * free round — which is precisely why it lives one level above both.
 *
 * What a mode adds is the deal itself: {@link PokerSession} deals hands and
 * moves a button; {@link FreeSession} opens rounds and applies the forced bets
 * the host declared. The three members below are the whole of the seam.
 */
export abstract class GameSession<TConfig extends GameConfig = GameConfig> {
  readonly id: string;
  status: GameSessionStatus;
  /** Immutable once the session is created */
  readonly config: TConfig;
  /**
   * The session creator's identity: a companion, not a seated player. Holds
   * host permissions (deal/close, proxying unclaimed seats) regardless of
   * whether they ever claim a seat themselves.
   */
  readonly ownerUuid: string;
  /** Every seat of the session, keyed by participant id. */
  readonly participants: Map<string, Participant>;

  /**
   * Seats are declared up front: the aggregate is always built from the full
   * seat list (fresh rows on creation, hydrated rows when a room re-opens).
   */
  constructor(
    id: string,
    config: TConfig,
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

  /** Whether a deal is being played right now. */
  abstract get dealInProgress(): boolean;

  /**
   * How many deals the table has got through. Each mode counts its own — hands
   * at a poker table, rounds at a free one — and the recap at the end reads
   * them the same way, because "how long did we play" is the same question.
   */
  abstract get dealsPlayed(): number;

  /**
   * What this mode calls a deal, singular — "hand" at a poker table, "round" at
   * a free one. Only ever used to word a refusal, so a player is told to wait
   * for the end of the thing they are actually watching.
   */
  protected abstract get dealNoun(): string;

  /** Settles whatever is open and stamps the session finished. */
  abstract closeSession(): void;

  /** Every seat, ordered by seat index. */
  get seats(): Participant[] {
    return [...this.participants.values()].sort(
      (a, b) => a.seatIndex - b.seatIndex,
    );
  }

  /**
   * Occupies a seat. Idempotent for an external identity that already holds one
   * (reconnects). Free seats can be claimed until the session finishes —
   * between deals included — unless the config locks them once the game has
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
      // deal and close the game, and it belongs to whoever created it. Taking
      // it has to be deliberate.
      seat = seats.find((p) => !p.claimed && p.role !== ParticipantRole.Host);
      if (!seat) {
        throw new BadRequestException('No free seat left');
      }
    }

    seat.claim(params.holderId, params.displayName);
    return seat;
  }

  /**
   * Whether a further seat may be opened at this table right now.
   *
   * Three conditions, and each rules out a different kind of mess:
   *
   * - The config allows it at all, because a host who fixed the table size meant
   *   it;
   * - Every declared seat is already claimed, because an empty chair is the
   *   answer to "someone else wants to play" — opening a tenth seat while the
   *   ninth sits free just adds chips nobody is holding;
   * - No deal is under way, because a seat dealt in halfway through owes what it
   *   never posted and sits in a rotation that has already passed it.
   *
   * The plan cap is deliberately _not_ checked here: the runtime does not know
   * who owns the session, let alone what they pay. `GameRoomsService` applies
   * that before calling in.
   */
  get canAddSeat(): boolean {
    if (!this.config.seating.allowExtraSeats) return false;
    if (this.status === GameSessionStatus.Finished) return false;
    if (this.dealInProgress) return false;
    return this.seats.every((seat) => seat.claimed);
  }

  /** {@link canAddSeat}, as a 400 that says which condition failed. */
  assertCanAddSeat(): void {
    if (!this.config.seating.allowExtraSeats) {
      throw new BadRequestException(
        'This table was set up with a fixed number of seats',
      );
    }
    if (this.status === GameSessionStatus.Finished) {
      throw new BadRequestException('Session is finished');
    }
    if (this.dealInProgress) {
      throw new BadRequestException(
        `A seat can only be added between ${this.dealNoun}s, not during one`,
      );
    }
    if (this.seats.some((seat) => !seat.claimed)) {
      throw new BadRequestException(
        'There is still a free seat — a new player should take that one',
      );
    }
  }

  /**
   * Opens a further seat at a full table.
   *
   * The new chair lands after the last one and starts unclaimed, exactly like a
   * declared seat that nobody has taken: `WAITING`, no controller, and the
   * host's to play until someone claims it. It is dealt in from the next deal,
   * never the current one — see {@link canAddSeat}.
   */
  addSeat(params: AddSeatParams): Participant {
    this.assertCanAddSeat();

    const seatIndex =
      this.seats.reduce(
        (highest, seat) => Math.max(highest, seat.seatIndex),
        -1,
      ) + 1;

    const seat = new Participant({
      id: params.id,
      seatIndex,
      role: ParticipantRole.Player,
      displayNameOverride: params.displayName,
      balance:
        params.initialBalance ?? this.config.seating.defaultInitialBalance,
      controller: null,
    });

    this.participants.set(seat.id, seat);
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
   * Resolves which seat an action acts on. With no target, it is the caller's
   * own seat — identified by the participant id their token carries, so it
   * cannot be another's. The host may instead target an unclaimed seat and act
   * on its behalf (a companion noting a table player's move); every declared
   * seat is dealt in from the first deal, claimed or not.
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

  /** A session that is over deals nothing more. */
  protected assertNotFinished(): void {
    if (this.status === GameSessionStatus.Finished) {
      throw new BadRequestException('Session is already finished');
    }
  }

  /** Moves the session out of the lobby the first time a deal opens. */
  protected startPlaying(): void {
    if (this.status === GameSessionStatus.Lobby) {
      this.status = GameSessionStatus.Running;
    }
  }
}
