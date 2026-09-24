import { Hand } from '@modules/game-core/poker/hand';
import { FIXED_LIMIT_MAX_RAISES } from '@modules/game-core/poker/legal-actions';
import { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import {
  BettingStructure,
  ChipModel,
  HandEndReason,
  HandStatus,
  ParticipantRole,
  ParticipantStatus,
  PokerAction,
  Street,
  type PokerRules,
} from '@tokenizer/shared/types';

const rules = (overrides: Partial<PokerRules> = {}): PokerRules => ({
  blinds: { small: 5, big: 10 },
  ante: 0,
  bettingStructure: BettingStructure.NoLimit,
  chipModel: ChipModel.AbstractBalance,
  ...overrides,
});

/** A table of seats, all claimed, with the stacks given. */
function table(stacks: number[]): Participant[] {
  return stacks.map(
    (balance, seatIndex) =>
      new Participant({
        id: crypto.randomUUID(),
        seatIndex,
        role: seatIndex === 0 ? ParticipantRole.Host : ParticipantRole.Player,
        displayNameOverride: null,
        balance,
        controller: `holder-${seatIndex}`,
      }),
  );
}

const deal = (order: Participant[], overrides: Partial<PokerRules> = {}) =>
  new Hand({
    handNumber: 1,
    rules: rules(overrides),
    order,
    dealerIndex: 0,
  });

/** What the seat on turn may do, by action. */
const optionsOf = (hand: Hand) =>
  Object.fromEntries(hand.legalActions().map((entry) => [entry.action, entry]));

const stacksOf = (order: Participant[]) => order.map((seat) => seat.balance);

describe('Hand', () => {
  it('previews the next owed action without changing the current player', () => {
    const order = table([1000, 1000, 1000]);
    const hand = deal(order);
    expect(hand.betting.nextActor?.id).toBe(order[1].id);
    expect(hand.betting.actor?.id).toBe(order[0].id);
    hand.submitAction(order[0], PokerAction.Call);
    expect(hand.betting.actor?.id).toBe(order[1].id);
    hand.submitAction(order[1], PokerAction.Call);
    // The big blind is last to act; nobody else currently owes a move.
    expect(hand.betting.nextActor).toBeNull();
  });

  describe('the blinds', () => {
    it('puts them to the button’s left and opens under the gun', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order);

      expect(hand.smallBlindId).toBe(order[1].id);
      expect(hand.bigBlindId).toBe(order[2].id);
      expect(hand.betting.actor?.id).toBe(order[0].id);
      expect(hand.potTotal).toBe(15);
      expect(stacksOf(order)).toEqual([1000, 995, 990]);
    });

    it('turns them around heads-up: the button posts the small blind', () => {
      const order = table([1000, 1000]);
      const hand = deal(order);

      expect(hand.smallBlindId).toBe(order[0].id);
      expect(hand.bigBlindId).toBe(order[1].id);
      // The button acts first before the flop...
      expect(hand.betting.actor?.id).toBe(order[0].id);

      hand.submitAction(order[0], PokerAction.Call);
      hand.submitAction(order[1], PokerAction.Check);

      // ...and last after it.
      expect(hand.street).toBe(Street.Flop);
      expect(hand.betting.actor?.id).toBe(order[1].id);
    });

    it('takes an ante off every seat before the blinds', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order, { ante: 2 });

      expect(hand.potTotal).toBe(21);
      expect(stacksOf(order)).toEqual([998, 993, 988]);
      // The ante is not a bet: it buys nobody anything towards the call.
      expect(hand.betting.currentBet).toBe(10);
      expect(hand.betting.committedBy(order[0].id)).toBe(0);
    });
  });

  describe('the betting round', () => {
    it('gives the big blind its option, and closes on a check', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.Call);
      hand.submitAction(order[1], PokerAction.Call);
      // Everybody has matched, and the big blind may still raise.
      expect(hand.betting.actor?.id).toBe(order[2].id);
      expect(optionsOf(hand)[PokerAction.Check]).toBeDefined();
      expect(optionsOf(hand)[PokerAction.Raise]).toMatchObject({ min: 20 });

      hand.submitAction(order[2], PokerAction.Check);
      expect(hand.street).toBe(Street.Flop);
      expect(hand.betting.currentBet).toBe(0);
    });

    it('re-opens the action behind a raise', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.Call);
      hand.submitAction(order[1], PokerAction.Raise, 40);

      // The seat that already called owes an answer again.
      expect(hand.betting.actor?.id).toBe(order[2].id);
      hand.submitAction(order[2], PokerAction.Call);
      expect(hand.betting.actor?.id).toBe(order[0].id);
      expect(hand.street).toBe(Street.Preflop);
    });

    it('refuses a raise under the minimum', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order);

      expect(() => hand.submitAction(order[0], PokerAction.Raise, 15)).toThrow(
        BadRequestException,
      );
    });

    it('refuses a move out of turn', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order);

      expect(() => hand.submitAction(order[1], PokerAction.Call)).toThrow(
        BadRequestException,
      );
    });

    it('lets a short all-in raise be called, but not re-raised', () => {
      // Seat 2 can put in 60 all told: more than the 50 standing, less than a
      // full raise above it.
      const order = table([1000, 1000, 60]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.Raise, 50);
      hand.submitAction(order[1], PokerAction.Call, 50);
      expect(optionsOf(hand)[PokerAction.Raise]).toMatchObject({
        min: 60,
        max: 60,
      });
      hand.submitAction(order[2], PokerAction.Raise, 60);

      // Seat 0 owes the extra ten and may pay it — but the incomplete raise
      // bought it no right to put the bet up again.
      expect(hand.betting.actor?.id).toBe(order[0].id);
      const options = optionsOf(hand);
      expect(options[PokerAction.Call]).toMatchObject({ min: 60, max: 60 });
      expect(options[PokerAction.Raise]).toBeUndefined();
      expect(options[PokerAction.AllIn]).toBeUndefined();
    });
  });

  describe('the end of a hand', () => {
    it('awards the pot uncontested, uncalled chips included', () => {
      const order = table([1000, 1000]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.Raise, 50);
      hand.submitAction(order[1], PokerAction.Fold);

      expect(hand.status).toBe(HandStatus.Settled);
      expect(hand.resolution?.reason).toBe(HandEndReason.Uncontested);
      // The 40 nobody called comes straight back: it was never contested.
      expect(stacksOf(order)).toEqual([1010, 990]);
    });

    it('runs the streets out and goes to showdown when everybody is all-in', () => {
      const order = table([1000, 1000]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.AllIn, 1000);
      hand.submitAction(order[1], PokerAction.Call, 1000);

      expect(hand.status).toBe(HandStatus.Showdown);
      expect(hand.legalActions()).toEqual([]);
      expect(hand.potTotal).toBe(2000);
    });

    it('splits a pot evenly, odd chip to the first seat left of the button', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order, { blinds: { small: 5, big: 7 } });

      hand.submitAction(order[0], PokerAction.Fold);
      hand.submitAction(order[1], PokerAction.Call);
      hand.submitAction(order[2], PokerAction.Check);
      for (let street = 0; street < 3; street++) {
        hand.submitAction(order[1], PokerAction.Check);
        hand.submitAction(order[2], PokerAction.Check);
      }

      const [pot] = hand.pots();
      expect(pot.amount).toBe(14);
      const resolution = hand.declareWinners([
        { potId: pot.id, winnerParticipantIds: [order[1].id, order[2].id] },
      ]);

      expect(resolution.payouts).toEqual([
        { participantId: order[1].id, amount: 7 },
        { participantId: order[2].id, amount: 7 },
      ]);
    });

    it('refuses a showdown while the betting is still open', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order);

      expect(() =>
        hand.declareWinners([
          { potId: hand.pots()[0].id, winnerParticipantIds: [order[0].id] },
        ]),
      ).toThrow(BadRequestException);
    });

    it('takes a seat out of the game once its stack is gone', () => {
      const order = table([1000, 1000]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.AllIn, 1000);
      hand.submitAction(order[1], PokerAction.Call, 1000);
      hand.declareWinners([
        { potId: hand.pots()[0].id, winnerParticipantIds: [order[0].id] },
      ]);

      expect(order[0].balance).toBe(2000);
      expect(order[1].balance).toBe(0);
      expect(order[1].status).toBe(ParticipantStatus.Eliminated);
    });
  });

  describe('side pots', () => {
    it('splits the betting into layers the short stack cannot reach', () => {
      // Seat 1 can only cover 50 of the 100 the others put in.
      const order = table([100, 50, 200]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.AllIn, 100);
      hand.submitAction(order[1], PokerAction.Call, 50);
      hand.submitAction(order[2], PokerAction.Call, 100);

      expect(hand.status).toBe(HandStatus.Showdown);
      const [main, side] = hand.pots();
      expect(main).toMatchObject({ amount: 150, isSidePot: false });
      expect(main.eligibleParticipants).toHaveLength(3);
      expect(side).toMatchObject({ amount: 100, isSidePot: true });
      expect(side.eligibleParticipants).toEqual([order[0].id, order[2].id]);
    });

    it('pays each pot to the seats that actually contested it', () => {
      const order = table([100, 50, 200]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.AllIn, 100);
      hand.submitAction(order[1], PokerAction.Call, 50);
      hand.submitAction(order[2], PokerAction.Call, 100);

      const [main, side] = hand.pots();
      hand.declareWinners([
        { potId: main.id, winnerParticipantIds: [order[1].id] },
        { potId: side.id, winnerParticipantIds: [order[2].id] },
      ]);

      // The short stack takes the main pot, the side pot goes to the only
      // other seat that paid into it.
      expect(stacksOf(order)).toEqual([0, 150, 200]);
    });

    it('refuses to award a pot to a seat that never paid into it', () => {
      const order = table([100, 50, 200]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.AllIn, 100);
      hand.submitAction(order[1], PokerAction.Call, 50);
      hand.submitAction(order[2], PokerAction.Call, 100);

      const [main, side] = hand.pots();
      expect(() =>
        hand.declareWinners([
          { potId: main.id, winnerParticipantIds: [order[1].id] },
          { potId: side.id, winnerParticipantIds: [order[1].id] },
        ]),
      ).toThrow(BadRequestException);
    });

    it('refuses a showdown that leaves a pot unclaimed', () => {
      const order = table([100, 50, 200]);
      const hand = deal(order);

      hand.submitAction(order[0], PokerAction.AllIn, 100);
      hand.submitAction(order[1], PokerAction.Call, 50);
      hand.submitAction(order[2], PokerAction.Call, 100);

      expect(() =>
        hand.declareWinners([
          { potId: hand.pots()[0].id, winnerParticipantIds: [order[1].id] },
        ]),
      ).toThrow(BadRequestException);
    });
  });

  describe('betting structures', () => {
    it('caps a pot-limit raise at the size of the pot after the call', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order, {
        bettingStructure: BettingStructure.PotLimit,
      });

      // 15 in the middle, 10 to call: the most that may go in is 35.
      expect(optionsOf(hand)[PokerAction.Raise]).toMatchObject({
        min: 20,
        max: 35,
      });
      expect(optionsOf(hand)[PokerAction.AllIn]).toBeUndefined();
    });

    it('fixes the bet size under fixed limit, and doubles it from the turn', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order, {
        bettingStructure: BettingStructure.FixedLimit,
      });

      expect(optionsOf(hand)[PokerAction.Raise]).toMatchObject({
        min: 20,
        max: 20,
      });

      hand.submitAction(order[0], PokerAction.Call);
      hand.submitAction(order[1], PokerAction.Call);
      hand.submitAction(order[2], PokerAction.Check);
      // Flop, then turn.
      for (let street = 0; street < 2; street++) {
        hand.submitAction(order[1], PokerAction.Check);
        hand.submitAction(order[2], PokerAction.Check);
        hand.submitAction(order[0], PokerAction.Check);
      }

      expect(hand.street).toBe(Street.River);
      expect(optionsOf(hand)[PokerAction.Bet]).toMatchObject({
        min: 20,
        max: 20,
      });
    });

    it('caps the number of raises on a fixed-limit street', () => {
      const order = table([1000, 1000, 1000]);
      const hand = deal(order, {
        bettingStructure: BettingStructure.FixedLimit,
      });

      // The big blind counts as the first bet; three raises close it out.
      const raisers = [order[0], order[1], order[2], order[0]];
      raisers.slice(0, FIXED_LIMIT_MAX_RAISES - 1).forEach((seat, index) => {
        hand.submitAction(seat, PokerAction.Raise, 20 + index * 10);
      });

      expect(hand.betting.raiseCount).toBe(FIXED_LIMIT_MAX_RAISES);
      expect(optionsOf(hand)[PokerAction.Raise]).toBeUndefined();
      expect(optionsOf(hand)[PokerAction.Call]).toBeDefined();
    });
  });
});
