import type { Participant } from '@modules/game-core/runtime/participant';
import { ParticipantStatus, Street } from '@tokenizer/shared/types';

/**
 * One betting round — a street's worth of action, and nothing more.
 *
 * The whole of "when does this stop" lives in `toAct`: the seats that still owe
 * an answer. Everybody who can act owes one when the street opens; acting pays
 * the debt; a bet or a raise puts every other live seat back in debt. The
 * street closes when the set empties, which is the same rule at every table in
 * the world and the reason the big blind gets its option without a special case
 * for it.
 */
export class BettingRound {
  readonly street: Street;
  /** The total each seat must have committed here to stay in the hand. */
  currentBet: number;
  /** Size of the last full bet or raise: the minimum increment for the next. */
  lastRaiseSize: number;
  /** Bets and raises made here, for the fixed-limit cap. */
  raiseCount: number;
  readonly committed: Map<string, number>;

  /** Every seat dealt into the hand, in table order. */
  private readonly order: Participant[];
  private actorIndex: Nullable<number>;
  private readonly toAct: Set<string>;
  /**
   * Seats that may answer the bet but may no longer put it up. Only an all-in
   * that falls short of a full raise ever lands anybody here.
   */
  private readonly raisingClosed: Set<string>;

  constructor(params: {
    street: Street;
    order: Participant[];
    /** Where the action starts: an index into `order`. */
    firstToActIndex: number;
    /** Carried in from the blinds on the first street; 0 afterwards. */
    currentBet?: number;
    /** The big blind, which is the opening minimum everywhere. */
    minimumRaiseSize: number;
    /** Street commitments already standing (the blinds). */
    committed?: ReadonlyMap<string, number>;
  }) {
    this.street = params.street;
    this.order = params.order;
    this.currentBet = params.currentBet ?? 0;
    this.lastRaiseSize = params.minimumRaiseSize;
    this.raiseCount = params.currentBet ? 1 : 0;
    this.committed = new Map(params.committed ?? []);

    this.toAct = new Set(
      params.order
        .filter((p) => p.status === ParticipantStatus.Active)
        .map((p) => p.id),
    );
    this.raisingClosed = new Set();
    this.actorIndex = null;
    this.actorIndex = this.seek(params.firstToActIndex, true);
  }

  /** The seat that owes an action, or null once the street is closed. */
  get actor(): Nullable<Participant> {
    return this.actorIndex === null ? null : this.order[this.actorIndex];
  }

  get closed(): boolean {
    return this.actorIndex === null;
  }

  /** The smallest legal raise, as a total for this street. */
  get minRaiseTo(): number {
    return this.currentBet + this.lastRaiseSize;
  }

  committedBy(participantId: string): number {
    return this.committed.get(participantId) ?? 0;
  }

  /** Records chips going in, and returns how many actually moved. */
  commit(participant: Participant, total: number): number {
    const already = this.committedBy(participant.id);
    const delta = Math.min(Math.max(0, total - already), participant.balance);
    if (delta === 0) return 0;

    participant.balance -= delta;
    this.committed.set(participant.id, already + delta);
    if (participant.balance === 0) {
      participant.status = ParticipantStatus.AllIn;
    }
    return delta;
  }

  /**
   * Raises the bar, and puts the table back in debt for the difference.
   *
   * A raise that falls short of a full one — which only an all-in can be — is
   * the exception poker actually has a rule for: the seats that already
   * answered the bet it failed to raise still owe the extra chips, but they
   * have lost the right to put it up again. They may call or fold, nothing
   * else, until somebody makes a full raise and re-opens it for everyone.
   */
  raiseTo(total: number): void {
    const increment = total - this.currentBet;
    const full = increment >= this.lastRaiseSize;

    if (full) {
      this.lastRaiseSize = increment;
      this.raisingClosed.clear();
    } else {
      for (const seat of this.order) {
        if (
          seat.status === ParticipantStatus.Active &&
          !this.toAct.has(seat.id)
        ) {
          this.raisingClosed.add(seat.id);
        }
      }
    }

    this.currentBet = total;
    this.raiseCount += 1;
    for (const seat of this.order) {
      if (seat.status === ParticipantStatus.Active) this.toAct.add(seat.id);
    }
  }

  /** Whether this seat may still put the bet up, rather than only answer it. */
  canRaise(participantId: string): boolean {
    return !this.raisingClosed.has(participantId);
  }

  /** The seat has answered: it owes nothing more until somebody raises. */
  settle(participantId: string): void {
    this.toAct.delete(participantId);
  }

  /** Out of the street for good — folded, or all-in with nothing left to say. */
  retire(participantId: string): void {
    this.toAct.delete(participantId);
  }

  /** Hands the turn to the next seat that owes an action. */
  advance(): void {
    if (this.actorIndex === null) return;
    this.actorIndex = this.seek(this.actorIndex, false);
  }

  /** Closes the street outright; used when the hand ends mid-action. */
  close(): void {
    this.actorIndex = null;
    this.toAct.clear();
  }

  /**
   * First seat at or after `start` that still owes an action. `inclusive` is
   * what separates opening a street (the first-to-act seat may be the answer)
   * from stepping through one (it cannot be the seat that just acted).
   */
  private seek(start: number, inclusive: boolean): Nullable<number> {
    const seats = this.order.length;
    if (seats === 0 || this.toAct.size === 0) return null;

    for (let offset = inclusive ? 0 : 1; offset < seats + 1; offset++) {
      const index = (((start + offset) % seats) + seats) % seats;
      const seat = this.order[index];
      if (this.toAct.has(seat.id) && seat.status === ParticipantStatus.Active) {
        return index;
      }
    }
    return null;
  }
}
