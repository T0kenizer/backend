import type { Participant } from '@modules/game-core/runtime/participant';

export class Pot {
  readonly id: string;
  amount: number;
  eligibleParticipants: string[];

  constructor(eligibleParticipants: string[] = []) {
    this.id = crypto.randomUUID();
    this.amount = 0;
    this.eligibleParticipants = [...eligibleParticipants];
  }

  addContribution(participantId: string, amount: number): void {
    if (amount <= 0) return;
    if (!this.eligibleParticipants.includes(participantId)) {
      this.eligibleParticipants.push(participantId);
    }
    this.amount += amount;
  }

  /**
   * Empties the pot into the winners' balances: split equally, remainder to the
   * first winner so no chips are lost to integer division.
   */
  payOut(winners: Participant[]): void {
    if (winners.length === 0 || this.amount === 0) return;

    const share = Math.floor(this.amount / winners.length);
    const remainder = this.amount - share * winners.length;
    this.amount = 0;
    winners.forEach((winner, index) => {
      winner.balance += share + (index === 0 ? remainder : 0);
    });
  }
}
