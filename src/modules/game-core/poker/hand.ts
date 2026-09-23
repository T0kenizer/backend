import { BettingRound } from '@modules/game-core/poker/betting-round';
import { HandEvent } from '@modules/game-core/poker/hand-event';
import { legalActionsFor } from '@modules/game-core/poker/legal-actions';
import { buildPots, type PotLayer } from '@modules/game-core/poker/pots';
import type { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import { MIN_SEATS } from '@tokenizer/shared/constants/games.constants';
import {
  GameMode,
  HandEndReason,
  HandEventType,
  HandStatus,
  ParticipantStatus,
  PokerAction,
  Street,
  type HandPayout,
  type HandResolution,
  type LegalAction,
  type PokerRules,
  type PotAward,
} from '@tokenizer/shared/types';

/** The streets in the order they are played. */
const STREETS = [
  Street.Preflop,
  Street.Flop,
  Street.Turn,
  Street.River,
] as const;

const EVENT_FOR_ACTION: Record<PokerAction, HandEventType> = {
  [PokerAction.Fold]: HandEventType.Fold,
  [PokerAction.Check]: HandEventType.Check,
  [PokerAction.Call]: HandEventType.Call,
  [PokerAction.Bet]: HandEventType.Bet,
  [PokerAction.Raise]: HandEventType.Raise,
  [PokerAction.AllIn]: HandEventType.AllIn,
};

export interface HandParams {
  handNumber: number;
  rules: PokerRules;
  /** Every seat dealt in, in table order. */
  order: Participant[];
  /** Index into `order` of the seat holding the button. */
  dealerIndex: number;
}

/**
 * One deal, from the blinds to the payout.
 *
 * A hand is the unit poker is actually played in, and it holds four betting
 * rounds rather than being one — which is the distinction the old "round" was
 * missing, and with it every rule that depends on a street ending: the pot
 * carrying over, the action re-opening from the button, the showdown arriving
 * at all.
 *
 * Tokenizer deals no cards. Everything here is the chips' half of poker, and
 * the one thing it cannot know — who actually had the best hand — is the one
 * thing it asks the table for.
 */
export class Hand {
  readonly id: string;
  readonly handNumber: number;
  status: HandStatus;
  street: Street;
  readonly order: Participant[];
  readonly dealerIndex: number;
  readonly smallBlindId: string;
  readonly bigBlindId: string;
  /**
   * What each seat has put in across the whole hand; the pots are built from
   * it.
   */
  readonly contributions: Map<string, number>;
  readonly events: HandEvent[];
  betting: BettingRound;
  resolution: Nullable<HandResolution>;

  private readonly rules: PokerRules;
  private readonly potIds: string[];

  constructor(params: HandParams) {
    if (params.order.length < MIN_SEATS) {
      throw new BadRequestException(`A hand needs at least ${MIN_SEATS} seats`);
    }

    this.id = crypto.randomUUID();
    this.handNumber = params.handNumber;
    this.rules = params.rules;
    this.order = params.order;
    this.dealerIndex = params.dealerIndex;
    this.status = HandStatus.Betting;
    this.street = Street.Preflop;
    this.contributions = new Map();
    this.events = [];
    this.potIds = [];
    this.resolution = null;

    const seats = this.order.length;
    // Heads-up turns the blinds around: the button posts the small blind and
    // acts first before the flop, last after it. Everywhere else the blinds sit
    // to the left of the button, as they look on the table.
    const headsUp = seats === 2;
    const smallIndex = headsUp
      ? this.dealerIndex
      : (this.dealerIndex + 1) % seats;
    const bigIndex = headsUp
      ? (this.dealerIndex + 1) % seats
      : (this.dealerIndex + 2) % seats;

    this.smallBlindId = this.order[smallIndex].id;
    this.bigBlindId = this.order[bigIndex].id;

    for (const seat of this.order) {
      this.post(seat, this.rules.ante, HandEventType.Ante);
    }

    const blinds = new Map<string, number>();
    blinds.set(
      this.smallBlindId,
      this.post(
        this.order[smallIndex],
        this.rules.blinds.small,
        HandEventType.SmallBlind,
      ),
    );
    blinds.set(
      this.bigBlindId,
      this.post(
        this.order[bigIndex],
        this.rules.blinds.big,
        HandEventType.BigBlind,
      ),
    );

    this.betting = new BettingRound({
      street: Street.Preflop,
      order: this.order,
      // Under the gun: the seat after the big blind, or the button heads-up.
      firstToActIndex: headsUp ? smallIndex : (bigIndex + 1) % seats,
      // The bar is the full big blind even when the seat that owes it is too
      // short to post it: being all-in for less does not lower the price.
      currentBet: this.rules.blinds.big,
      minimumRaiseSize: this.rules.blinds.big,
      committed: blinds,
    });

    // Antes and blinds alone can put everybody all-in.
    this.progress();
  }

  /** Every seat still contesting the pot: not folded, not sitting out. */
  contenders(): Participant[] {
    return this.order.filter(
      (p) =>
        p.status === ParticipantStatus.Active ||
        p.status === ParticipantStatus.AllIn,
    );
  }

  /** The seats that can still put chips in. */
  private live(): Participant[] {
    return this.order.filter((p) => p.status === ParticipantStatus.Active);
  }

  /** The pots as they stand: the main one, then whatever the all-ins split off. */
  pots(): PotLayer[] {
    return buildPots(
      this.contributions,
      new Set(this.contenders().map((p) => p.id)),
      (index) => (this.potIds[index] ??= crypto.randomUUID()),
    );
  }

  get potTotal(): number {
    let total = 0;
    for (const amount of this.contributions.values()) total += amount;
    return total;
  }

  /** What the seat that owes an action may do; empty when nobody owes one. */
  legalActions(): LegalAction[] {
    const actor = this.betting.actor;
    if (!actor || this.status !== HandStatus.Betting) return [];

    return legalActionsFor({
      rules: this.rules,
      street: this.street,
      currentBet: this.betting.currentBet,
      minRaiseTo: this.betting.minRaiseTo,
      raiseCount: this.betting.raiseCount,
      committed: this.betting.committedBy(actor.id),
      stack: actor.balance,
      potTotal: this.potTotal,
      canRaise: this.betting.canRaise(actor.id),
    });
  }

  /**
   * Plays a move.
   *
   * Validated against {@link legalActions} rather than against a rule written
   * out a second time here: the list the client was offered and the list the
   * server enforces have to be the same list, or the table eventually shows a
   * button that the server then refuses.
   *
   * @param amount The **total** the seat will have committed on this street.
   */
  submitAction(
    participant: Participant,
    action: PokerAction,
    amount?: number,
  ): HandEvent {
    if (this.status !== HandStatus.Betting) {
      throw new BadRequestException(
        this.status === HandStatus.Showdown
          ? 'The betting is finished — the table declares who takes the pot'
          : 'The hand is already settled',
      );
    }
    if (this.betting.actor?.id !== participant.id) {
      throw new BadRequestException('It is not this seat’s turn');
    }

    const legal = this.legalActions().find((entry) => entry.action === action);
    if (!legal) {
      throw new BadRequestException(`${action} is not legal right now`);
    }

    let committed = 0;

    if (legal.min !== undefined && legal.max !== undefined) {
      const total = legal.min === legal.max ? legal.min : amount;
      if (total === undefined) {
        throw new BadRequestException(`${action} needs an amount`);
      }
      if (total < legal.min || total > legal.max) {
        throw new BadRequestException(
          `${action} must be between ${legal.min} and ${legal.max}`,
        );
      }

      committed = this.betting.commit(participant, total);
      this.contributions.set(
        participant.id,
        (this.contributions.get(participant.id) ?? 0) + committed,
      );

      if (total > this.betting.currentBet) this.betting.raiseTo(total);
    }

    if (action === PokerAction.Fold) {
      participant.status = ParticipantStatus.Folded;
      this.betting.retire(participant.id);
    } else if (participant.status === ParticipantStatus.AllIn) {
      this.betting.retire(participant.id);
    } else {
      this.betting.settle(participant.id);
    }

    const event = this.log(
      participant.id,
      EVENT_FOR_ACTION[action],
      committed || undefined,
    );

    this.betting.advance();
    this.progress();

    return event;
  }

  /**
   * The showdown, as a companion app can hold one: the cards are on the table
   * and the app never sees them, so the winners are declared.
   *
   * A pot none of the declared winners paid into is not theirs to take — it
   * goes to whoever did pay into it, which is the only answer a side pot has
   * when the seat that built it was not named.
   */
  declareWinners(awards: PotAward[]): HandResolution {
    if (this.status !== HandStatus.Showdown) {
      throw new BadRequestException(
        this.status === HandStatus.Settled
          ? 'The hand is already settled'
          : 'The betting is not finished yet',
      );
    }

    const pots = this.pots();
    const byPot = new Map(awards.map((award) => [award.potId, award]));

    for (const pot of pots) {
      const award = byPot.get(pot.id);
      if (!award) {
        throw new BadRequestException(
          `No winner was named for the ${pot.isSidePot ? 'side pot' : 'main pot'}`,
        );
      }
      const outsider = award.winnerParticipantIds.find(
        (id) => !pot.eligibleParticipants.includes(id),
      );
      if (outsider) {
        throw new BadRequestException(
          'A seat that did not pay into a pot cannot take it',
        );
      }
    }

    return this.settle(HandEndReason.Showdown, (pot) =>
      byPot.get(pot.id)!.winnerParticipantIds.slice(),
    );
  }

  /** Awards the pot without a showdown; used when the session is closed early. */
  abandon(): HandResolution {
    if (this.status === HandStatus.Settled) return this.resolution!;
    const contenders = new Set(this.contenders().map((p) => p.id));
    // Nobody showed anything, so nobody can be said to have won: each pot goes
    // back to the seats that were still contesting it.
    return this.settle(HandEndReason.Uncontested, (pot) =>
      pot.eligibleParticipants.filter((id) => contenders.has(id)),
    );
  }

  /**
   * Where the hand goes next, asked after every action.
   *
   * Three questions in order, and the order is the rules: is anybody left to
   * beat, is the betting round over, and is there another street to play.
   */
  private progress(): void {
    if (this.status !== HandStatus.Betting) return;

    const contenders = this.contenders();
    if (contenders.length <= 1) {
      this.betting.close();
      const survivors = contenders.map((p) => p.id);
      this.settle(HandEndReason.Uncontested, () => survivors);
      return;
    }

    if (!this.betting.closed) return;

    const nextStreet = STREETS[STREETS.indexOf(this.street) + 1];

    // Nothing left to bet — everyone is all-in but at most one, and that one
    // has matched. The remaining streets are cards being turned over, which is
    // the table's business and not the app's, so the hand goes straight to the
    // showdown it was always going to reach.
    if (!nextStreet || this.live().length < 2) {
      this.status = HandStatus.Showdown;
      return;
    }

    this.street = nextStreet;
    this.log(null, HandEventType.StreetDealt);
    this.betting = new BettingRound({
      street: nextStreet,
      order: this.order,
      // After the flop the action starts at the button's left, every street.
      firstToActIndex: (this.dealerIndex + 1) % this.order.length,
      minimumRaiseSize: this.rules.blinds.big,
    });

    // An opened street can close on the spot when only one seat can still act.
    this.progress();
  }

  /**
   * Empties the pots into their winners and closes the hand.
   *
   * `winnersOf` is asked pot by pot rather than given a flat list, because that
   * is the only shape that survives a side pot: the seats eligible for one are
   * not the seats eligible for the next.
   */
  private settle(
    reason: HandEndReason,
    winnersOf: (pot: PotLayer) => string[],
  ): HandResolution {
    const byId = new Map(this.order.map((p) => [p.id, p]));
    const totals = new Map<string, number>();

    for (const pot of this.pots()) {
      const takers = winnersOf(pot).sort(
        (a, b) => this.positionAfterButton(a) - this.positionAfterButton(b),
      );
      if (!takers.length) continue;

      const share = Math.floor(pot.amount / takers.length);
      const remainder = pot.amount - share * takers.length;

      takers.forEach((id, index) => {
        // The odd chip goes to the first seat left of the button, which is the
        // rule every card room settles it by.
        const amount = share + (index < remainder ? 1 : 0);
        if (amount > 0) totals.set(id, (totals.get(id) ?? 0) + amount);
      });
    }

    const payouts: HandPayout[] = [];
    for (const [participantId, amount] of totals) {
      const seat = byId.get(participantId);
      if (!seat) continue;
      seat.balance += amount;
      payouts.push({ participantId, amount });
    }

    // Out of chips is out of the game: a seat with nothing in front of it
    // cannot post a blind, so it does not get dealt the next hand.
    for (const seat of this.order) {
      if (seat.balance === 0) seat.status = ParticipantStatus.Eliminated;
    }

    this.status = HandStatus.Settled;
    this.betting.close();
    this.resolution = {
      mode: GameMode.Poker,
      handId: this.id,
      reason,
      winners: payouts.map((payout) => payout.participantId),
      payouts,
    };
    return this.resolution;
  }

  /** How far left of the button a seat sits; the tie-break for an odd chip. */
  private positionAfterButton(participantId: string): number {
    const seats = this.order.length;
    const index = this.order.findIndex((p) => p.id === participantId);
    if (index === -1) return seats;
    return (((index - this.dealerIndex - 1) % seats) + seats) % seats;
  }

  /** Moves chips that are owed rather than chosen: the antes and the blinds. */
  private post(
    participant: Participant,
    amount: number,
    type: HandEventType,
  ): number {
    const posted = Math.min(amount, participant.balance);
    if (posted <= 0) return 0;

    participant.balance -= posted;
    this.contributions.set(
      participant.id,
      (this.contributions.get(participant.id) ?? 0) + posted,
    );
    if (participant.balance === 0) {
      participant.status = ParticipantStatus.AllIn;
    }
    this.log(participant.id, type, posted);
    return posted;
  }

  private log(
    participantId: Nullable<string>,
    type: HandEventType,
    amount?: number,
  ): HandEvent {
    const event = new HandEvent({
      participantId,
      type,
      street: this.street,
      amount,
    });
    this.events.push(event);
    return event;
  }
}
