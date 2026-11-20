import { Hand } from '@modules/game-core/poker/hand';
import { GameSession } from '@modules/game-core/runtime/game-session';
import type { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import { MIN_SEATS } from '@tokenizer/shared/constants/games.constants';
import {
  GameSessionStatus,
  HandStatus,
  ParticipantStatus,
  type PokerGameConfig,
} from '@tokenizer/shared/types';

export class PokerSession extends GameSession<PokerGameConfig> {
  currentHand?: Hand;
  handsPlayed = 0;

  private lastButtonSeatIndex: Nullable<number> = null;

  get dealInProgress(): boolean {
    return (
      this.currentHand !== undefined &&
      this.currentHand.status !== HandStatus.Settled
    );
  }

  protected get dealNoun(): string {
    return 'hand';
  }

  get dealsPlayed(): number {
    return this.handsPlayed;
  }

  /**
   * Whether the game has been won: a hand has been played, none is running, and
   * too few seats still hold chips to deal the next one. The last stack
   * standing takes the table, so there is nothing left for the host to decide.
   */
  get isDecided(): boolean {
    return (
      this.status === GameSessionStatus.Running &&
      !this.dealInProgress &&
      this.seatsWithChips().length < MIN_SEATS
    );
  }

  startHand(): Hand {
    this.assertNotFinished();
    if (this.dealInProgress) {
      throw new BadRequestException(
        'Finish the current hand before dealing the next one',
      );
    }

    const dealtIn = this.seatsWithChips();
    if (dealtIn.length < MIN_SEATS) {
      throw new BadRequestException(
        `At least ${MIN_SEATS} seats with chips are required to deal a hand`,
      );
    }

    this.startPlaying();

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

  private seatsWithChips(): Participant[] {
    return this.seats.filter(
      (p) => p.status !== ParticipantStatus.Eliminated && p.balance > 0,
    );
  }

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
