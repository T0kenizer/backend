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
  private readonly participants: Participant[];

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

  get nextParticipant(): Nullable<string> {
    if (
      this.interruptionOpen ||
      this.policy.regime === TurnRegime.Simultaneous
    ) {
      return null;
    }
    const currentIndex = this.participants.findIndex(
      (participant) => participant.id === this.activeParticipant,
    );
    if (currentIndex === -1) return null;
    const step = this.policy.direction === Direction.Clockwise ? 1 : -1;
    const count = this.participants.length;
    for (let offset = 1; offset < count; offset++) {
      const index = (((currentIndex + step * offset) % count) + count) % count;
      if (this.participants[index].status === ParticipantStatus.Active) {
        return this.participants[index].id;
      }
    }
    return null;
  }

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

  openInterruptionWindow(): boolean {
    if (this.policy.regime !== TurnRegime.SequentialInterruptible) return false;
    if (this.policy.interruptionWindow === null) return false;

    this.interruptionOpen = true;
    return true;
  }

  closeInterruptionWindow(): void {
    this.interruptionOpen = false;
    this.pendingClaims = [];
  }

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
