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
  order: Participant[];
  dealerIndex: number;
}

export class Hand {
  readonly id: string;
  readonly handNumber: number;
  status: HandStatus;
  street: Street;
  readonly order: Participant[];
  readonly dealerIndex: number;
  readonly smallBlindId: string;
  readonly bigBlindId: string;
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
      firstToActIndex: headsUp ? smallIndex : (bigIndex + 1) % seats,
      currentBet: this.rules.blinds.big,
      minimumRaiseSize: this.rules.blinds.big,
      committed: blinds,
    });

    this.progress();
  }

  contenders(): Participant[] {
    return this.order.filter(
      (p) =>
        p.status === ParticipantStatus.Active ||
        p.status === ParticipantStatus.AllIn,
    );
  }

  private live(): Participant[] {
    return this.order.filter((p) => p.status === ParticipantStatus.Active);
  }

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

  abandon(): HandResolution {
    if (this.status === HandStatus.Settled) return this.resolution!;
    const contenders = new Set(this.contenders().map((p) => p.id));
    return this.settle(HandEndReason.Uncontested, (pot) =>
      pot.eligibleParticipants.filter((id) => contenders.has(id)),
    );
  }

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

    if (!nextStreet || this.live().length < 2) {
      this.status = HandStatus.Showdown;
      return;
    }

    this.street = nextStreet;
    this.log(null, HandEventType.StreetDealt);
    this.betting = new BettingRound({
      street: nextStreet,
      order: this.order,
      firstToActIndex: (this.dealerIndex + 1) % this.order.length,
      minimumRaiseSize: this.rules.blinds.big,
    });

    this.progress();
  }

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

  private positionAfterButton(participantId: string): number {
    const seats = this.order.length;
    const index = this.order.findIndex((p) => p.id === participantId);
    if (index === -1) return seats;
    return (((index - this.dealerIndex - 1) % seats) + seats) % seats;
  }

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
