import type {
  AddSeatParams,
  ClaimParams,
  SeatInit,
  UpdateSeatParams,
} from '@modules/game-core/game-core.types';
import { Hand } from '@modules/game-core/poker/hand';
import { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import {
  GameSessionStatus,
  HandStatus,
  ParticipantRole,
  ParticipantStatus,
  type GameConfig,
} from '@tokenizer/shared/types';

export class GameSession {
  readonly id: string;
  status: GameSessionStatus;
  /** Immutable once the session is created */
  readonly config: GameConfig;
  /**
   * The session creator's identity: a companion, not a seated player. Holds
   * host permissions (deal/close, proxying unclaimed seats) regardless of
   * whether they ever claim a seat themselves.
   */
  readonly ownerUuid: string;
  /** Every seat of the session, keyed by participant id. */
  readonly participants: Map<string, Participant>;
  currentHand?: Hand;
  handsPlayed: number;

  /**
   * Where the button sat last hand, as a seat index rather than a seat: the
   * seat that held it may be out of chips by the time the next hand is dealt,
   * and the button still has to move on from where it was.
   */
  private lastButtonSeatIndex: Nullable<number>;

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
    this.handsPlayed = 0;
    this.lastButtonSeatIndex = null;
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

  /** Whether a hand is being played right now. */
  get handInProgress(): boolean {
    return (
      this.currentHand !== undefined &&
      this.currentHand.status !== HandStatus.Settled
    );
  }

  /**
   * Occupies a seat. Idempotent for an external identity that already holds one
   * (reconnects). Free seats can be claimed until the session finishes —
   * between hands included — unless the config locks them once the game has
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
   * - No hand is under way, because a seat dealt in halfway through owes blinds
   *   it never posted and sits in a rotation that has already passed it.
   *
   * The plan cap is deliberately _not_ checked here: the runtime does not know
   * who owns the session, let alone what they pay. `GameRoomsService` applies
   * that before calling in.
   */
  get canAddSeat(): boolean {
    if (!this.config.seating.allowExtraSeats) return false;
    if (this.status === GameSessionStatus.Finished) return false;
    if (this.handInProgress) return false;
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
    if (this.handInProgress) {
      throw new BadRequestException(
        'A seat can only be added between hands, not during one',
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
   * host's to play until someone claims it. It is dealt in from the next hand,
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
   * seat is dealt in from the first hand, claimed or not.
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

  /**
   * Deals the next hand: moves the button, brings everybody back in, and posts
   * the antes and blinds.
   */
  startHand(): Hand {
    if (this.status === GameSessionStatus.Finished) {
      throw new BadRequestException('Session is already finished');
    }
    if (this.handInProgress) {
      throw new BadRequestException(
        'Finish the current hand before dealing the next one',
      );
    }

    // Every declared seat is a real chair at the table — claimed or not, the
    // host notes moves for whoever hasn't claimed theirs yet. Only seats with
    // nothing left in front of them stay out: they cannot post a blind.
    const dealtIn = this.seats.filter(
      (p) => p.status !== ParticipantStatus.Eliminated && p.balance > 0,
    );
    if (dealtIn.length < 2) {
      throw new BadRequestException(
        'At least 2 seats with chips are required to deal a hand',
      );
    }

    if (this.status === GameSessionStatus.Lobby) {
      this.status = GameSessionStatus.Running;
    }

    // Last hand's folds and all-ins are last hand's. Everyone dealt in comes
    // back in as a live seat.
    for (const seat of dealtIn) seat.status = ParticipantStatus.Active;

    const dealerIndex = this.nextDealerIndex(dealtIn);
    this.lastButtonSeatIndex = dealtIn[dealerIndex].seatIndex;
    this.handsPlayed += 1;

    const hand = new Hand({
      handNumber: this.handsPlayed,
      rules: this.config.rules,
      order: dealtIn,
      dealerIndex,
    });
    this.currentHand = hand;
    return hand;
  }

  /**
   * Where the button lands. It moves one seat to its left every hand, skipping
   * whoever is out — which is why it is tracked by seat index and not by seat:
   * the player who held it last may be gone.
   */
  private nextDealerIndex(dealtIn: Participant[]): number {
    if (this.lastButtonSeatIndex === null) return 0;

    const next = dealtIn.findIndex(
      (seat) => seat.seatIndex > this.lastButtonSeatIndex!,
    );
    return next === -1 ? 0 : next;
  }

  closeSession(): void {
    if (this.currentHand && this.currentHand.status !== HandStatus.Settled) {
      this.currentHand.abandon();
    }
    this.status = GameSessionStatus.Finished;
  }
}
