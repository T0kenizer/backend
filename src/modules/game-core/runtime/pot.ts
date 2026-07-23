import type { ParticipantId, PotId } from '@modules/game-core/game-core.types';
import type { Participant } from '@modules/game-core/runtime/participant';

export class Pot {
  readonly id: PotId;
  amount: number;
  eligibleParticipants: ParticipantId[];

  constructor(eligibleParticipants: ParticipantId[] = []) {
    this.id = crypto.randomUUID();
    this.amount = 0;
    this.eligibleParticipants = [...eligibleParticipants];
  }

  addContribution(participantId: ParticipantId, amount: number): void {
    if (amount <= 0) return;
    if (!this.eligibleParticipants.includes(participantId)) {
      this.eligibleParticipants.push(participantId);
    }
    this.amount += amount;
  }

  awardTo(winner: Participant): void {
    if (!this.eligibleParticipants.includes(winner.id)) {
      throw new Error(
        `Participant ${winner.id} is not eligible for pot ${this.id}`,
      );
    }
    winner.balance += this.amount;
    this.amount = 0;
  }
}
