import type { Participant } from '@modules/game-core/runtime/participant';
import { ParticipantStatus, Street } from '@tokenizer/shared/types';

export class BettingRound {
  readonly street: Street;
  currentBet: number;
  lastRaiseSize: number;
  raiseCount: number;
  readonly committed: Map<string, number>;

  private readonly order: Participant[];
  private actorIndex: Nullable<number>;
  private readonly toAct: Set<string>;
  private readonly raisingClosed: Set<string>;

  constructor(params: {
    street: Street;
    order: Participant[];
    firstToActIndex: number;
    currentBet?: number;
    minimumRaiseSize: number;
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

  get actor(): Nullable<Participant> {
    return this.actorIndex === null ? null : this.order[this.actorIndex];
  }

  get closed(): boolean {
    return this.actorIndex === null;
  }

  /** Preview the existing queue without advancing or assuming a raise. */
  get nextActor(): Nullable<Participant> {
    if (this.actorIndex === null) return null;
    const index = this.seek(this.actorIndex, false);
    return index === null || index === this.actorIndex
      ? null
      : this.order[index];
  }

  get minRaiseTo(): number {
    return this.currentBet + this.lastRaiseSize;
  }

  committedBy(participantId: string): number {
    return this.committed.get(participantId) ?? 0;
  }

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

  canRaise(participantId: string): boolean {
    return !this.raisingClosed.has(participantId);
  }

  settle(participantId: string): void {
    this.toAct.delete(participantId);
  }

  retire(participantId: string): void {
    this.toAct.delete(participantId);
  }

  advance(): void {
    if (this.actorIndex === null) return;
    this.actorIndex = this.seek(this.actorIndex, false);
  }

  close(): void {
    this.actorIndex = null;
    this.toAct.clear();
  }

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
