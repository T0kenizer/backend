import type { ActionDef } from '@modules/game-core/config/action-def';
import {
  Direction,
  TurnRegime,
  type TurnPolicy,
} from '@modules/game-core/config/turn-policy';
import type { ParticipantId } from '@modules/game-core/game-core.types';
import {
  ParticipantStatus,
  type Participant,
} from '@modules/game-core/runtime/participant';

export interface InterruptionClaim {
  participantId: ParticipantId;
  definitionId: string;
  claimedAt: Date;
}

export class TurnState {
  activeParticipant: ParticipantId;
  interruptionOpen: boolean;
  pendingClaims: InterruptionClaim[];

  private readonly policy: TurnPolicy;
  private readonly catalog: ActionDef[];
  /** Ordered by seatIndex, held by reference — Round keeps this in sync */
  private readonly participants: Participant[];
  private interruptionTimer?: ReturnType<typeof setTimeout>;

  constructor(
    policy: TurnPolicy,
    catalog: ActionDef[],
    orderedParticipants: Participant[],
  ) {
    if (orderedParticipants.length === 0) {
      throw new Error('TurnState requires at least one participant');
    }
    this.policy = policy;
    this.catalog = catalog;
    this.participants = orderedParticipants;
    this.activeParticipant = orderedParticipants[0].id;
    this.interruptionOpen = false;
    this.pendingClaims = [];
  }

  computeLegalActions(): ActionDef[] {
    if (this.policy.regime === TurnRegime.SIMULTANEOUS) {
      return this.catalog;
    }
    if (this.interruptionOpen) {
      return this.catalog.filter((a) => a.grantsInterruption);
    }
    return this.catalog;
  }

  advance(): void {
    const eligible = this.participants.filter(
      (p) =>
        p.status === ParticipantStatus.ACTIVE ||
        p.status === ParticipantStatus.WAITING,
    );
    if (eligible.length === 0) return;

    const currentIndex = eligible.findIndex(
      (p) => p.id === this.activeParticipant,
    );

    if (this.policy.direction === Direction.CLOCKWISE) {
      this.activeParticipant =
        eligible[(currentIndex + 1) % eligible.length].id;
    } else {
      this.activeParticipant =
        eligible[(currentIndex - 1 + eligible.length) % eligible.length].id;
    }

    this.closeInterruptionWindow();
  }

  openInterruptionWindow(onExpire?: () => void): void {
    if (this.policy.regime !== TurnRegime.SEQUENTIAL_INTERRUPTIBLE) return;
    if (this.policy.interruptionWindow === null) return;

    this.interruptionOpen = true;

    if (onExpire) {
      this.interruptionTimer = setTimeout(() => {
        this.closeInterruptionWindow();
        onExpire();
      }, this.policy.interruptionWindow);
    }
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
  resolveClaims(): InterruptionClaim | null {
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
      throw new Error('No interruption window is open');
    }
    this.pendingClaims.push(claim);
  }
}
