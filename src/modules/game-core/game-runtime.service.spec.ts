import type { SeatInit } from '@modules/game-core/game-core.types';
import { defaultConfigFor } from '@modules/game-core/game-modes';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import type { RuntimeSnapshot } from '@modules/game-core/game-runtime.snapshot';
import { BadRequestException } from '@nestjs/common';
import {
  GameMode,
  HandEndReason,
  HandStatus,
  ParticipantRole,
  ParticipantStatus,
  PokerAction,
  Street,
} from '@tokenizer/shared/types';

const GAME_ID = '11111111-1111-4111-8111-111111111111';
const HOST_UUID = '22222222-2222-4222-8222-222222222222';

/**
 * Seats as `GameSessionsService` builds them: all unclaimed, named from the
 * config. Seat 0 keeps the HOST role, but role no longer implies a claim — the
 * host's permissions come from the session's ownerUuid instead.
 */
function buildSeats(count: number, initialBalance = 1000): SeatInit[] {
  return Array.from({ length: count }, (_, seatIndex) => ({
    id: crypto.randomUUID(),
    seatIndex,
    role: seatIndex === 0 ? ParticipantRole.Host : ParticipantRole.Player,
    displayNameOverride: null,
    balance: initialBalance,
    controller: null,
  }));
}

function activeOf(snapshot: RuntimeSnapshot): Nullable<string> {
  return snapshot.currentHand?.betting.activeParticipant ?? null;
}

function potOf(snapshot: RuntimeSnapshot): number {
  return (
    snapshot.currentHand?.pots.reduce((total, pot) => total + pot.amount, 0) ??
    0
  );
}

describe('GameRuntimeService', () => {
  let service: GameRuntimeService;

  /** The seat a holder occupies — what every action is addressed by now. */
  function seatOf(holderId: string, gameId = GAME_ID): string {
    const id = service.findSeatByHolder(gameId, holderId);
    if (!id) throw new Error(`No seat held by ${holderId}`);
    return id;
  }

  function hostSeatId(gameId = GAME_ID): string {
    return seatOf(HOST_UUID, gameId);
  }

  /** The seat at this index, by id. */
  function seatAt(index: number, gameId = GAME_ID): string {
    return service.snapshot(gameId).participants[index].id;
  }

  /** Plays a move on a seat, proxied by the host when nobody claimed it. */
  function play(action: PokerAction, seatIndex: number, amount?: number) {
    const target = seatAt(seatIndex);
    const holder = service
      .snapshot(GAME_ID)
      .participants.find((p) => p.id === target)!.controller;

    return service.submitAction(
      GAME_ID,
      holder ? target : hostSeatId(),
      holder
        ? { action, amount }
        : { action, amount, targetParticipantId: target },
    );
  }

  beforeEach(() => {
    service = new GameRuntimeService();
    service.registerSession(
      GAME_ID,
      defaultConfigFor(GameMode.Poker),
      HOST_UUID,
      buildSeats(4),
    );
    // Creating a game seats its owner in seat 0; the runtime tests start from
    // that same state, since host authority is carried by the seat.
    service.claimSeat(GAME_ID, { holderId: HOST_UUID, seatIndex: 0 });
  });

  it('opens with pre-declared seats, only the host one claimed', () => {
    const snapshot = service.snapshot(GAME_ID);

    expect(snapshot.mode).toBe(GameMode.Poker);
    expect(snapshot.stakes.blinds).toEqual({ small: 5, big: 10 });
    expect(snapshot.participants).toHaveLength(4);
    expect(snapshot.participants[0]).toMatchObject({
      role: ParticipantRole.Host,
      status: ParticipantStatus.Active,
      controller: HOST_UUID,
      displayNameOverride: null,
    });
    for (const seat of snapshot.participants.slice(1)) {
      expect(seat).toMatchObject({
        role: ParticipantRole.Player,
        status: ParticipantStatus.Waiting,
        controller: null,
      });
    }
  });

  describe('claimSeat', () => {
    it('assigns the first free seat and is idempotent per identity', () => {
      const first = service.claimSeat(GAME_ID, {
        holderId: 'bob',
        displayName: 'Bob',
      });
      const again = service.claimSeat(GAME_ID, {
        holderId: 'bob',
        displayName: 'Bobby',
      });

      expect(first.participantId).toBe(again.participantId);
      const bob = again.snapshot.participants.find((p) => p.seatIndex === 1);
      expect(bob).toMatchObject({
        controller: 'bob',
        displayNameOverride: 'Bob', // re-claims keep the original name
        status: ParticipantStatus.Active,
      });
    });

    it('claims an explicit seat and rejects taken or unknown ones', () => {
      service.claimSeat(GAME_ID, {
        holderId: 'bob',
        displayName: 'Bob',
        seatIndex: 3,
      });
      const snapshot = service.snapshot(GAME_ID);
      expect(snapshot.participants[3].controller).toBe('bob');

      expect(() =>
        service.claimSeat(GAME_ID, {
          holderId: 'carol',
          displayName: 'Carol',
          seatIndex: 3,
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        service.claimSeat(GAME_ID, {
          holderId: 'carol',
          displayName: 'Carol',
          seatIndex: 9,
        }),
      ).toThrow(BadRequestException);
    });

    it('locks free seats once the game has started when configured', () => {
      const config = defaultConfigFor(GameMode.Poker);
      config.seating.allowMidGameClaims = false;
      const lockedGame = '33333333-3333-4333-8333-333333333333';
      service.registerSession(lockedGame, config, HOST_UUID, buildSeats(4));
      service.claimSeat(lockedGame, { holderId: HOST_UUID, seatIndex: 0 });
      service.claimSeat(lockedGame, { holderId: 'bob', displayName: 'Bob' });
      service.claimSeat(lockedGame, {
        holderId: 'carol',
        displayName: 'Carol',
      });

      service.startHand(lockedGame);

      // New identities are locked out...
      expect(() =>
        service.claimSeat(lockedGame, {
          holderId: 'dave',
          displayName: 'Dave',
        }),
      ).toThrow(BadRequestException);
      // ...but a seated player can still re-claim (reconnect)
      const reclaim = service.claimSeat(lockedGame, {
        holderId: 'bob',
        displayName: 'Bob',
      });
      expect(reclaim.snapshot.participants[1].controller).toBe('bob');
    });

    it('rejects claims when no seat is left', () => {
      // Three player seats; the fourth is the host's and is never handed out.
      for (const name of ['bob', 'carol', 'dave']) {
        service.claimSeat(GAME_ID, { holderId: name, displayName: name });
      }
      expect(() =>
        service.claimSeat(GAME_ID, {
          holderId: 'frank',
          displayName: 'Frank',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('startHand', () => {
    it('deals every seat in, posts the blinds and opens under the gun', () => {
      // No claims at all: the host proxies every seat from the first hand.
      const { snapshot } = service.startHand(GAME_ID);
      const hand = snapshot.currentHand!;

      expect(snapshot.status).toBe('RUNNING');
      expect(hand.handNumber).toBe(1);
      expect(hand.street).toBe(Street.Preflop);
      // The button opens on seat 0; the blinds sit to its left.
      expect(hand.dealerParticipant).toBe(seatAt(0));
      expect(hand.smallBlindParticipant).toBe(seatAt(1));
      expect(hand.bigBlindParticipant).toBe(seatAt(2));
      // Under the gun is the seat after the big blind, not seat 0.
      expect(activeOf(snapshot)).toBe(seatAt(3));
      expect(potOf(snapshot)).toBe(15);
      expect(hand.betting.currentBet).toBe(10);
    });

    it('moves the button one seat on every hand', () => {
      service.startHand(GAME_ID);
      // Fold round the table: seat 2 (the big blind) is left holding it.
      play(PokerAction.Fold, 3);
      play(PokerAction.Fold, 0);
      play(PokerAction.Fold, 1);

      const { snapshot } = service.startHand(GAME_ID);
      expect(snapshot.currentHand!.handNumber).toBe(2);
      expect(snapshot.currentHand!.dealerParticipant).toBe(seatAt(1));
    });

    it('refuses to deal over a hand that is still being played', () => {
      service.startHand(GAME_ID);
      expect(() => service.startHand(GAME_ID)).toThrow(BadRequestException);
    });
  });

  describe('a hand played out', () => {
    it('awards the pot uncontested when everyone folds to one seat', () => {
      service.claimSeat(GAME_ID, { holderId: 'bob', displayName: 'Bob' });
      service.startHand(GAME_ID);

      play(PokerAction.Fold, 3);
      play(PokerAction.Fold, 0);
      const final = play(PokerAction.Fold, 1);

      // Seat 2 posted the big blind and is the only seat left in.
      expect(final.resolution?.reason).toBe(HandEndReason.Uncontested);
      expect(final.resolution?.winners).toEqual([seatAt(2)]);
      expect(final.snapshot.currentHand?.status).toBe(HandStatus.Settled);

      const balances = Object.fromEntries(
        final.snapshot.participants.map((p) => [p.seatIndex, p.balance]),
      );
      expect(balances).toEqual({ 0: 1000, 1: 995, 2: 1005, 3: 1000 });
    });

    it('closes the street once everyone has matched, and opens the next', () => {
      service.startHand(GAME_ID);

      play(PokerAction.Call, 3, 10);
      play(PokerAction.Call, 0, 10);
      play(PokerAction.Call, 1, 10);
      // The big blind still gets its option, and taking it closes the street.
      const { snapshot } = play(PokerAction.Check, 2);

      const hand = snapshot.currentHand!;
      expect(hand.street).toBe(Street.Flop);
      expect(potOf(snapshot)).toBe(40);
      expect(hand.betting.currentBet).toBe(0);
      // After the flop the action starts to the button's left, not under the gun.
      expect(activeOf(snapshot)).toBe(seatAt(1));
    });

    it('re-opens the betting when a raise lands behind a call', () => {
      service.startHand(GAME_ID);

      play(PokerAction.Call, 3, 10);
      const raised = play(PokerAction.Raise, 0, 30);

      expect(raised.snapshot.currentHand!.betting.currentBet).toBe(30);
      expect(raised.snapshot.currentHand!.betting.minRaiseTo).toBe(50);
      // Seat 3 called ten and now owes an answer to the raise again.
      play(PokerAction.Call, 1, 30);
      play(PokerAction.Call, 2, 30);
      const { snapshot } = play(PokerAction.Call, 3, 30);

      expect(snapshot.currentHand!.street).toBe(Street.Flop);
      expect(potOf(snapshot)).toBe(120);
    });

    it('reaches a showdown after the river and pays the declared winner', () => {
      service.startHand(GAME_ID);

      // Pre-flop: everyone in for ten.
      play(PokerAction.Call, 3, 10);
      play(PokerAction.Call, 0, 10);
      play(PokerAction.Call, 1, 10);
      play(PokerAction.Check, 2);

      // Three checked streets.
      for (let street = 0; street < 3; street++) {
        for (const seat of [1, 2, 3, 0]) play(PokerAction.Check, seat);
      }

      const snapshot = service.snapshot(GAME_ID);
      expect(snapshot.currentHand!.status).toBe(HandStatus.Showdown);
      expect(snapshot.currentHand!.betting.legalActions).toEqual([]);

      const { resolution, snapshot: settled } = service.declareWinners(
        GAME_ID,
        [
          {
            potId: snapshot.currentHand!.pots[0].id,
            winnerParticipantIds: [seatAt(3)],
          },
        ],
      );

      expect(resolution.reason).toBe(HandEndReason.Showdown);
      expect(resolution.payouts).toEqual([
        { participantId: seatAt(3), amount: 40 },
      ]);
      expect(settled.participants[3].balance).toBe(1030);
    });

    it('refuses a showdown while chips are still moving', () => {
      const { snapshot } = service.startHand(GAME_ID);
      expect(() =>
        service.declareWinners(GAME_ID, [
          {
            potId: snapshot.currentHand!.pots[0].id,
            winnerParticipantIds: [seatAt(3)],
          },
        ]),
      ).toThrow(BadRequestException);
    });

    it('refuses a move that is not legal right now', () => {
      service.startHand(GAME_ID);
      // Ten is owed under the gun: a check is not on the table.
      expect(() => play(PokerAction.Check, 3)).toThrow(BadRequestException);
    });

    it('refuses a raise below the minimum', () => {
      service.startHand(GAME_ID);
      expect(() => play(PokerAction.Raise, 3, 15)).toThrow(BadRequestException);
    });
  });

  describe('proxy actions (host acting on behalf of an unclaimed seat)', () => {
    it('rejects a non-host caller targeting another seat', () => {
      service.claimSeat(GAME_ID, {
        holderId: 'bob',
        displayName: 'Bob',
        seatIndex: 3,
      });
      service.startHand(GAME_ID);

      expect(() =>
        service.submitAction(GAME_ID, seatOf('bob'), {
          targetParticipantId: seatAt(2),
          action: PokerAction.Call,
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects the host targeting an already-claimed seat', () => {
      service.claimSeat(GAME_ID, {
        holderId: 'bob',
        displayName: 'Bob',
        seatIndex: 3,
      });
      service.startHand(GAME_ID);

      expect(() =>
        service.submitAction(GAME_ID, hostSeatId(), {
          targetParticipantId: seatOf('bob'),
          action: PokerAction.Call,
        }),
      ).toThrow(BadRequestException);
    });
  });

  it('carries host authority on the HOST seat, not on an identity', () => {
    expect(service.isHost(GAME_ID, hostSeatId())).toBe(true);

    service.claimSeat(GAME_ID, { holderId: 'bob', displayName: 'Bob' });
    expect(service.isHost(GAME_ID, seatOf('bob'))).toBe(false);
  });

  it('never hands the host seat to a player taking the first free one', () => {
    service.claimSeat(GAME_ID, { holderId: 'bob', displayName: 'Bob' });

    const bob = service
      .snapshot(GAME_ID)
      .participants.find((p) => p.controller === 'bob');
    expect(bob?.seatIndex).toBe(1);
    expect(bob?.role).toBe(ParticipantRole.Player);
  });

  describe('addSeat', () => {
    const NEW_SEAT_ID = '33333333-3333-4333-8333-333333333333';

    /** Fills every declared seat, which is the precondition for a new one. */
    function fillTable(gameId = GAME_ID) {
      ['bob', 'carol', 'dave'].forEach((holderId) =>
        service.claimSeat(gameId, { holderId }),
      );
    }

    it('opens a seat at the end once every chair is taken', () => {
      fillTable();
      expect(service.canAddSeat(GAME_ID)).toBe(true);

      service.addSeat(GAME_ID, { id: NEW_SEAT_ID, displayName: 'Seat 5' });

      const seats = service.snapshot(GAME_ID).participants;
      expect(seats).toHaveLength(5);
      expect(seats[4]).toMatchObject({
        id: NEW_SEAT_ID,
        seatIndex: 4,
        role: ParticipantRole.Player,
        displayNameOverride: 'Seat 5',
        // Unclaimed, exactly like a declared seat nobody took — which is what
        // makes it the host's to play until someone claims it.
        controller: null,
        status: ParticipantStatus.Waiting,
      });
    });

    it('starts the new seat on the session default stack', () => {
      fillTable();
      service.addSeat(GAME_ID, { id: NEW_SEAT_ID, displayName: 'Seat 5' });

      expect(service.snapshot(GAME_ID).participants[4].balance).toBe(1000);
    });

    it('honours an explicit starting stack', () => {
      fillTable();
      service.addSeat(GAME_ID, {
        id: NEW_SEAT_ID,
        displayName: 'Seat 5',
        initialBalance: 250,
      });

      expect(service.snapshot(GAME_ID).participants[4].balance).toBe(250);
    });

    it('refuses while a chair is still free', () => {
      expect(service.canAddSeat(GAME_ID)).toBe(false);
      expect(() =>
        service.addSeat(GAME_ID, { id: NEW_SEAT_ID, displayName: 'Seat 5' }),
      ).toThrow(BadRequestException);
    });

    it('refuses mid-hand, when the blinds are already down', () => {
      fillTable();
      service.startHand(GAME_ID);

      expect(service.canAddSeat(GAME_ID)).toBe(false);
      expect(() =>
        service.addSeat(GAME_ID, { id: NEW_SEAT_ID, displayName: 'Seat 5' }),
      ).toThrow(BadRequestException);
    });

    it('refuses when the table was set up with a fixed size', () => {
      const FIXED_GAME = '44444444-4444-4444-8444-444444444444';
      const config = defaultConfigFor(GameMode.Poker);
      config.seating.allowExtraSeats = false;

      service.registerSession(FIXED_GAME, config, HOST_UUID, buildSeats(2));
      service.claimSeat(FIXED_GAME, { holderId: HOST_UUID, seatIndex: 0 });
      service.claimSeat(FIXED_GAME, { holderId: 'bob' });

      expect(service.canAddSeat(FIXED_GAME)).toBe(false);
      expect(() =>
        service.addSeat(FIXED_GAME, { id: NEW_SEAT_ID, displayName: 'Seat 3' }),
      ).toThrow(BadRequestException);
    });

    it('lets the added seat be claimed like any other', () => {
      fillTable();
      service.addSeat(GAME_ID, { id: NEW_SEAT_ID, displayName: 'Seat 5' });

      service.claimSeat(GAME_ID, { holderId: 'erin' });

      expect(seatOf('erin')).toBe(NEW_SEAT_ID);
      expect(service.canAddSeat(GAME_ID)).toBe(true);
    });
  });
});
