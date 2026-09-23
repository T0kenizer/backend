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

/**
 * A poker table.
 *
 * Everything about seats it inherits; what it adds is the deal — the button and
 * the hand it opens. The rules themselves live in {@link Hand}, which is where
 * legality, pots and settlement are decided; this only says who is dealt in and
 * where the button lands.
 */
export class PokerSession extends GameSession<PokerGameConfig> {
  currentHand?: Hand;
  handsPlayed = 0;

  /**
   * Where the button sat last hand, as a seat index rather than a seat: the
   * seat that held it may be out of chips by the time the next hand is dealt,
   * and the button still has to move on from where it was.
   */
  private lastButtonSeatIndex: Nullable<number> = null;

  /** Whether a hand is being played right now. */
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
   * Deals the next hand: moves the button, brings everybody back in, and posts
   * the antes and blinds.
   */
  startHand(): Hand {
    this.assertNotFinished();
    if (this.dealInProgress) {
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
    if (dealtIn.length < MIN_SEATS) {
      throw new BadRequestException(
        `At least ${MIN_SEATS} seats with chips are required to deal a hand`,
      );
    }

    this.startPlaying();

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
