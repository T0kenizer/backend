import { FreeSession } from '@modules/game-core/free/free-session';
import type { SeatInit } from '@modules/game-core/game-core.types';
import { defaultConfigFor } from '@modules/game-core/game-modes';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import { BadRequestException } from '@nestjs/common';
import {
  EndResolution,
  GameMode,
  ParticipantRole,
  ParticipantStatus,
  PokerAction,
  RoundStatus,
  type FreeGameConfig,
} from '@tokenizer/shared/types';

const GAME_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_UUID = '44444444-4444-4444-8444-444444444444';

function freeConfig(): FreeGameConfig {
  const config = defaultConfigFor(GameMode.Free);
  if (config.mode !== GameMode.Free) {
    throw new Error('The free mode opened on another mode’s config');
  }
  return config;
}

function buildSeats(count: number, balance = 1000): SeatInit[] {
  return Array.from({ length: count }, (_, seatIndex) => ({
    id: crypto.randomUUID(),
    seatIndex,
    role: seatIndex === 0 ? ParticipantRole.Host : ParticipantRole.Player,
    displayNameOverride: null,
    balance,
    controller: null,
  }));
}

function openSession(config: FreeGameConfig = freeConfig(), seats = 4) {
  return new FreeSession(GAME_ID, config, OWNER_UUID, buildSeats(seats));
}

/** No sockets in a runtime test, so nobody is connected to anything. */
const nobodyConnected = () => false;

describe('FreeSession', () => {
  describe('starting a round', () => {
    it('takes the forced bets the host declared, off the seats they name', () => {
      const session = openSession();
      const round = session.startRound();

      // The default table posts 5 at seat 0 and 10 at seat 1.
      expect(session.seats[0].balance).toBe(995);
      expect(session.seats[1].balance).toBe(990);
      expect(session.seats[2].balance).toBe(1000);
      expect(round.pots[0].amount).toBe(15);
      expect(round.status).toBe(RoundStatus.InProgress);
    });

    it('refuses to open a second round over an open one', () => {
      const session = openSession();
      session.startRound();

      expect(() => session.startRound()).toThrow(BadRequestException);
    });

    it('brings last round’s folded seats back in', () => {
      const session = openSession();
      session.startRound();
      const folder = session.seats[0];

      session.submitAction(folder, 'fold');
      expect(folder.status).toBe(ParticipantStatus.Folded);

      session.resolveRound();
      session.startRound();
      expect(folder.status).toBe(ParticipantStatus.Active);
    });
  });

  describe('playing a move', () => {
    it('refuses a move from a seat whose turn it is not', () => {
      const session = openSession();
      session.startRound();

      expect(() => session.submitAction(session.seats[2], 'check')).toThrow(
        BadRequestException,
      );
    });

    it('refuses an action the table never put in its catalog', () => {
      const session = openSession();
      session.startRound();

      expect(() => session.submitAction(session.seats[0], 'straddle')).toThrow(
        BadRequestException,
      );
    });

    it('moves the chips it is given and passes the turn on', () => {
      const session = openSession();
      const round = session.startRound();

      session.submitAction(session.seats[0], 'raise', 100);

      expect(session.seats[0].balance).toBe(895);
      expect(round.pots[0].amount).toBe(115);
      expect(round.turnState.activeParticipant).toBe(session.seats[1].id);
    });

    it('caps a move at the stack behind it rather than going negative', () => {
      const session = openSession(freeConfig(), 2);
      const round = session.startRound();

      session.submitAction(session.seats[0], 'raise', 10_000);

      expect(session.seats[0].balance).toBe(0);
      // 5 + 10 forced, then everything seat 0 had left.
      expect(round.pots[0].amount).toBe(1010);
    });
  });

  describe('ending a round', () => {
    it('settles on its own once a single contender is left', () => {
      const session = openSession(freeConfig(), 2);
      const round = session.startRound();

      const resolution = session.submitAction(session.seats[0], 'fold');

      expect(resolution).toEqual({
        mode: GameMode.Free,
        roundId: round.id,
        reason: 'LAST_PLAYER_STANDING',
        winners: [session.seats[1].id],
      });
      expect(round.status).toBe(RoundStatus.Resolved);
      // The survivor takes the 15 that was forced in.
      expect(session.seats[1].balance).toBe(1005);
    });

    it('leaves the round open when the host settles them by hand', () => {
      const config = freeConfig();
      config.endPolicy = {
        resolution: EndResolution.ManualHost,
        conditions: [],
      };
      const session = openSession(config, 2);
      session.startRound();

      const resolution = session.submitAction(session.seats[0], 'fold');

      expect(resolution).toBeUndefined();
      expect(session.currentRound!.status).toBe(RoundStatus.InProgress);
    });

    it('splits the pot between the winners the table names', () => {
      const session = openSession();
      const round = session.startRound();
      const [first, second] = session.seats;

      const resolution = session.resolveRound([first.id, second.id]);

      expect(resolution.reason).toBe('MANUAL_HOST');
      expect(round.status).toBe(RoundStatus.Resolved);
      // 15 in the pot, split two ways with the odd chip to the first seat.
      expect(first.balance).toBe(995 + 8);
      expect(second.balance).toBe(990 + 7);
    });

    it('pays whoever is still contesting it when nobody is named', () => {
      const session = openSession();
      session.startRound();
      session.submitAction(session.seats[0], 'fold');

      const resolution = session.resolveRound();

      expect(resolution.winners).not.toContain(session.seats[0].id);
      expect(resolution.winners).toHaveLength(3);
    });

    it('refuses to settle a round that is not open', () => {
      const session = openSession();

      expect(() => session.resolveRound()).toThrow(BadRequestException);
    });
  });

  describe('seats', () => {
    it('holds a new chair back until the round is over', () => {
      const session = openSession();
      for (const seat of session.seats) seat.claim(crypto.randomUUID());
      session.startRound();

      expect(session.canAddSeat).toBe(false);
      expect(() => session.assertCanAddSeat()).toThrow(
        /between rounds, not during one/,
      );

      session.resolveRound();
      expect(session.canAddSeat).toBe(true);
    });
  });

  it('settles whatever is open when the table closes', () => {
    const session = openSession();
    const round = session.startRound();

    session.closeSession();

    expect(round.status).toBe(RoundStatus.Resolved);
    expect(session.dealInProgress).toBe(false);
  });
});

/**
 * The seam above the engine: that a free config builds a free session at all,
 * that a poker payload is refused at one, and that the snapshot that leaves the
 * module is the free member of the union rather than poker's.
 */
describe('GameRuntimeService, on a free table', () => {
  let service: GameRuntimeService;

  beforeEach(() => {
    service = new GameRuntimeService();
    service.registerSession(GAME_ID, freeConfig(), OWNER_UUID, buildSeats(4));
  });

  it('serializes a round, never a hand', () => {
    const snapshot = service.snapshot(GAME_ID);

    expect(snapshot.mode).toBe(GameMode.Free);
    expect(snapshot.mode === GameMode.Free && snapshot.currentRound).toBeNull();
  });

  it('plays a catalog action through to a resolution', () => {
    const { snapshot } = service.startRound(GAME_ID);
    if (snapshot.mode !== GameMode.Free) throw new Error('not a free table');

    const seats = snapshot.participants;
    expect(snapshot.currentRound?.turn.activeParticipant).toBe(seats[0].id);
    expect(snapshot.currentRound?.pots[0].amount).toBe(15);
    // A free table pools into one pot, so nothing it produces is a side pot.
    expect(snapshot.currentRound?.pots[0].isSidePot).toBe(false);

    service.submitAction(
      GAME_ID,
      seats[0].id,
      { definitionId: 'fold' },
      nobodyConnected,
    );
    service.submitAction(
      GAME_ID,
      seats[1].id,
      { definitionId: 'fold' },
      nobodyConnected,
    );

    // Three of four folded leaves the pot uncontested, so the round closes on
    // the move itself rather than waiting on the host.
    const last = service.submitAction(
      GAME_ID,
      seats[2].id,
      {
        definitionId: 'fold',
      },
      nobodyConnected,
    );

    expect(last.resolution).toEqual({
      mode: GameMode.Free,
      roundId: snapshot.currentRound!.id,
      reason: 'LAST_PLAYER_STANDING',
      winners: [seats[3].id],
    });
  });

  it('refuses a poker move at a table that does not play poker', () => {
    const { snapshot } = service.startRound(GAME_ID);

    expect(() =>
      service.submitAction(
        GAME_ID,
        snapshot.participants[0].id,
        {
          action: PokerAction.Fold,
        },
        nobodyConnected,
      ),
    ).toThrow(/not playing poker|its own rules/);
  });

  it('refuses poker’s own calls outright', () => {
    expect(() => service.startHand(GAME_ID)).toThrow(BadRequestException);
    expect(() => service.declareWinners(GAME_ID, [])).toThrow(
      BadRequestException,
    );
  });
});
