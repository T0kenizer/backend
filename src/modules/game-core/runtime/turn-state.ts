import type { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import {
  Direction,
  ParticipantStatus,
  TurnRegime,
  type ActionDef,
  type TurnPolicy,
} from '@tokenizer/shared/types';

export interface InterruptionClaim {
  participantId: string;
  definitionId: string;
  claimedAt: Date;
}

export class TurnState {
  activeParticipant: string;
  interruptionOpen: boolean;
  pendingClaims: InterruptionClaim[];

  private readonly policy: TurnPolicy;
  private readonly catalog: ActionDef[];
  /** The round's participants, seat-ordered, held by reference. */
  private readonly participants: Participant[];
  private interruptionTimer?: ReturnType<typeof setTimeout>;

  constructor(
    policy: TurnPolicy,
    catalog: ActionDef[],
    orderedParticipants: Participant[],
  ) {
    if (orderedParticipants.length === 0) {
      throw new BadRequestException(
        'TurnState requires at least one participant',
      );
    }
    this.policy = policy;
    this.catalog = catalog;
    this.participants = orderedParticipants;
    this.activeParticipant = orderedParticipants[0].id;
    this.interruptionOpen = false;
    this.pendingClaims = [];
  }

  computeLegalActions(): ActionDef[] {
    if (this.policy.regime === TurnRegime.Simultaneous) {
      return this.catalog;
    }
    if (this.interruptionOpen) {
      return this.catalog.filter((a) => a.grantsInterruption);
    }
    return this.catalog;
  }

  /**
   * Moves the turn to the next participant still in contention. The rotation
   * walks the full seat order from the current holder — who may already be
   * folded (a folding action retires them before the turn advances) — so a fold
   * hands the turn to the _next_ seat, not back to seat 0.
   */
  advance(): void {
    const seats = this.participants.length;
    const currentIndex = this.participants.findIndex(
      (p) => p.id === this.activeParticipant,
    );
    if (currentIndex === -1) return;

    const step = this.policy.direction === Direction.Clockwise ? 1 : -1;
    for (let offset = 1; offset <= seats; offset++) {
      const index = (((currentIndex + step * offset) % seats) + seats) % seats;
      const candidate = this.participants[index];
      if (candidate.status === ParticipantStatus.Active) {
        this.activeParticipant = candidate.id;
        return;
      }
    }
  }

  /**
   * Opens the interruption window when the regime supports it. Returns whether
   * the window actually opened, so the caller can advance the turn normally
   * when it did not.
   */
  openInterruptionWindow(onExpire?: () => void): boolean {
    if (this.policy.regime !== TurnRegime.SequentialInterruptible) return false;
    if (this.policy.interruptionWindow === null) return false;

    this.interruptionOpen = true;

    if (onExpire) {
      this.interruptionTimer = setTimeout(() => {
        this.interruptionOpen = false;
        this.interruptionTimer = undefined;
        onExpire();
      }, this.policy.interruptionWindow);
      this.interruptionTimer.unref?.();
    }
    return true;
  }

  closeInterruptionWindow(): void {
    this.interruptionOpen = false;
    if (this.interruptionTimer !== undefined) {
      clearTimeout(this.interruptionTimer);
      this.interruptionTimer = undefined;
    }
    this.pendingClaims = [];
  }

  /**
   * FIFO priority among concurrent claimants. Returns the winning claim and
   * transfers the active turn to that participant.
   */
  resolveClaims(): Nullable<InterruptionClaim> {
    if (this.pendingClaims.length === 0) return null;

    const winner = [...this.pendingClaims].sort(
      (a, b) => a.claimedAt.getTime() - b.claimedAt.getTime(),
    )[0];

    this.closeInterruptionWindow();
    this.activeParticipant = winner.participantId;
    return winner;
  }

  addClaim(claim: InterruptionClaim): void {
    if (!this.interruptionOpen) {
      throw new BadRequestException('No interruption window is open');
    }
    this.pendingClaims.push(claim);
  }
}
