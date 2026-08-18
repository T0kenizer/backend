import type { SeatInit } from '@modules/game-core/game-core.types';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import type { RuntimeSnapshot } from '@modules/game-core/game-runtime.snapshot';
import { BadRequestException } from '@nestjs/common';
import { ParticipantRole, ParticipantStatus } from '@tokenizer/shared/types';

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
    hasPhotoOverride: false,
    balance: initialBalance,
    controller: null,
  }));
}

function activeOf(snapshot: RuntimeSnapshot): Nullable<string> {
  return snapshot.currentRound?.turn.activeParticipant ?? null;
}

describe('GameRuntimeService', () => {
  let service: GameRuntimeService;

  beforeEach(() => {
    service = new GameRuntimeService();
    service.registerSession(
      GAME_ID,
      defaultGameConfig(),
      HOST_UUID,
      buildSeats(4),
    );
  });

  it('opens with pre-declared seats, all unclaimed with no override', () => {
    // The config/account fallback for displayName+photo is resolved one layer
    // up (`GameRoomsService`, which has DB access); the runtime only tracks
    // whether an explicit override exists.
    const snapshot = service.snapshot(GAME_ID);

    expect(snapshot.participants).toHaveLength(4);
    expect(snapshot.participants[0]).toMatchObject({
      role: ParticipantRole.Host,
      status: ParticipantStatus.Waiting,
      controller: null,
      displayNameOverride: null,
      hasPhotoOverride: false,
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
        externalId: 'bob',
        displayName: 'Bob',
      });
      const again = service.claimSeat(GAME_ID, {
        externalId: 'bob',
        displayName: 'Bobby',
      });

      expect(first.participantId).toBe(again.participantId);
      const bob = again.snapshot.participants.find((p) => p.seatIndex === 0);
      expect(bob).toMatchObject({
        controller: 'bob',
        displayNameOverride: 'Bob', // re-claims keep the original name
        status: ParticipantStatus.Active,
      });
    });

    it('claims an explicit seat and rejects taken or unknown ones', () => {
      service.claimSeat(GAME_ID, {
        externalId: 'bob',
        displayName: 'Bob',
        seatIndex: 3,
      });
      const snapshot = service.snapshot(GAME_ID);
      expect(snapshot.participants[3].controller).toBe('bob');

      expect(() =>
        service.claimSeat(GAME_ID, {
          externalId: 'carol',
          displayName: 'Carol',
          seatIndex: 3,
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        service.claimSeat(GAME_ID, {
          externalId: 'carol',
          displayName: 'Carol',
          seatIndex: 9,
        }),
      ).toThrow(BadRequestException);
    });

    it('locks free seats once the game has started when configured', () => {
      const config = defaultGameConfig();
      config.seating.allowMidGameClaims = false;
      const lockedGame = '33333333-3333-4333-8333-333333333333';
      service.registerSession(lockedGame, config, HOST_UUID, buildSeats(4));
      service.claimSeat(lockedGame, { externalId: 'bob', displayName: 'Bob' });
      service.claimSeat(lockedGame, {
        externalId: 'carol',
        displayName: 'Carol',
      });

      service.startRound(lockedGame);

      // New identities are locked out...
      expect(() =>
        service.claimSeat(lockedGame, {
          externalId: 'dave',
          displayName: 'Dave',
        }),
      ).toThrow(BadRequestException);
      // ...but a seated player can still re-claim (reconnect)
      const reclaim = service.claimSeat(lockedGame, {
        externalId: 'bob',
        displayName: 'Bob',
      });
      expect(reclaim.snapshot.participants[0].controller).toBe('bob');
    });

    it('allows mid-game claims by default, taking over an already-active seat', () => {
      service.claimSeat(GAME_ID, { externalId: 'bob', displayName: 'Bob' });
      service.claimSeat(GAME_ID, {
        externalId: 'carol',
        displayName: 'Carol',
      });
      const started = service.startRound(GAME_ID);
      // Seat 2 is unclaimed but already a contender (the host proxies for it).
      const seat2Id = started.participants.find((p) => p.seatIndex === 2)!.id;
      expect(started.currentRound?.pots[0].eligibleParticipants).toContain(
        seat2Id,
      );

      const { snapshot } = service.claimSeat(GAME_ID, {
        externalId: 'dave',
        displayName: 'Dave',
        seatIndex: 2,
      });

      const dave = snapshot.participants.find((p) => p.controller === 'dave');
      expect(dave?.status).toBe(ParticipantStatus.Active);
      expect(dave?.id).toBe(seat2Id);
      // Dave now controls a seat that was already part of the running round.
      expect(snapshot.currentRound?.pots[0].eligibleParticipants).toContain(
        dave?.id,
      );
    });

    it('rejects claims when no seat is left', () => {
      for (const name of ['bob', 'carol', 'dave', 'eve']) {
        service.claimSeat(GAME_ID, { externalId: name, displayName: name });
      }
      expect(() =>
        service.claimSeat(GAME_ID, {
          externalId: 'frank',
          displayName: 'Frank',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('startRound', () => {
    it('starts with every declared seat, claimed or not', () => {
      // No claims at all: the host proxies every seat from round one.
      const snapshot = service.startRound(GAME_ID);

      const eligible = snapshot.currentRound!.pots[0].eligibleParticipants;
      expect(eligible).toHaveLength(4);
      expect(
        snapshot.participants.every(
          (p) => p.status === ParticipantStatus.Active,
        ),
      ).toBe(true);
    });
  });

  it('hands the turn to the next seat when the active participant folds', () => {
    service.claimSeat(GAME_ID, { externalId: 'bob', displayName: 'Bob' });
    service.claimSeat(GAME_ID, { externalId: 'carol', displayName: 'Carol' });
    service.claimSeat(GAME_ID, { externalId: 'dave', displayName: 'Dave' });

    let snapshot = service.startRound(GAME_ID);
    const [bob, carol, dave] = snapshot.participants;
    expect(activeOf(snapshot)).toBe(bob.id);

    // Bob checks → turn moves to Carol
    snapshot = service.submitAction(GAME_ID, {
      externalId: 'bob',
      definitionId: 'check',
    }).snapshot;
    expect(activeOf(snapshot)).toBe(carol.id);

    // Carol folds → the turn must move to Dave, the *next* seat, not wrap
    // back to seat 0 (the pre-fix behaviour).
    snapshot = service.submitAction(GAME_ID, {
      externalId: 'carol',
      definitionId: 'fold',
    }).snapshot;
    expect(activeOf(snapshot)).toBe(dave.id);
  });

  it('runs a round to a LAST_PLAYER_STANDING resolution', () => {
    // Only Bob claims a seat; seats 1-3 stay unclaimed but still play — the
    // host folds them on behalf of their (absent) table players.
    service.claimSeat(GAME_ID, { externalId: 'bob', displayName: 'Bob' });
    const started = service.startRound(GAME_ID);
    expect(started.status).toBe('RUNNING');
    expect(started.currentRound?.pots[0].amount).toBe(15);
    const [seat1, seat2, seat3] = started.participants.slice(1);

    service.submitAction(GAME_ID, { externalId: 'bob', definitionId: 'check' });
    service.submitAction(GAME_ID, {
      externalId: HOST_UUID,
      targetParticipantId: seat1.id,
      definitionId: 'fold',
    });
    service.submitAction(GAME_ID, {
      externalId: HOST_UUID,
      targetParticipantId: seat2.id,
      definitionId: 'fold',
    });
    const final = service.submitAction(GAME_ID, {
      externalId: HOST_UUID,
      targetParticipantId: seat3.id,
      definitionId: 'fold',
    });

    // Bob is the last one standing and takes the 15-chip pot
    const bobId = final.snapshot.participants.find(
      (p) => p.controller === 'bob',
    )!.id;
    expect(final.resolution?.reason).toBe('LAST_PLAYER_STANDING');
    expect(final.resolution?.winners).toEqual([bobId]);
    expect(final.snapshot.currentRound?.status).toBe('RESOLVED');

    const balances = Object.fromEntries(
      final.snapshot.participants.map((p) => [p.seatIndex, p.balance]),
    );
    expect(balances).toEqual({ 0: 1010, 1: 990, 2: 1000, 3: 1000 });
  });

  describe('resolveRound', () => {
    it('lets the host award explicit winners', () => {
      service.claimSeat(GAME_ID, { externalId: 'bob', displayName: 'Bob' });
      service.claimSeat(GAME_ID, {
        externalId: 'carol',
        displayName: 'Carol',
      });
      service.startRound(GAME_ID);

      const { resolution, snapshot } = service.resolveRound(GAME_ID, ['bob']);

      const bobId = snapshot.participants.find(
        (p) => p.controller === 'bob',
      )!.id;
      expect(resolution.reason).toBe('MANUAL_HOST');
      expect(resolution.winners).toEqual([bobId]);
      // Bob paid the small blind (5) and wins the 15-chip pot
      expect(
        snapshot.participants.find((p) => p.controller === 'bob')?.balance,
      ).toBe(1010);
    });

    it('rejects when no round is in progress', () => {
      expect(() => service.resolveRound(GAME_ID)).toThrow(BadRequestException);
    });
  });

  describe('proxy actions (host acting on behalf of an unclaimed seat)', () => {
    it('lets the host act on an unclaimed seat via targetParticipantId', () => {
      // Seat 0 (Bob) claimed; seats 1-3 unclaimed — the host proxies them.
      service.claimSeat(GAME_ID, { externalId: 'bob', displayName: 'Bob' });
      const started = service.startRound(GAME_ID);
      const seat1 = started.participants.find((p) => p.seatIndex === 1)!;

      // Bob (seat 0) acts first...
      let snapshot = service.submitAction(GAME_ID, {
        externalId: 'bob',
        definitionId: 'check',
      }).snapshot;
      expect(activeOf(snapshot)).toBe(seat1.id);

      // ...then the host, unrelated to any seat itself, proxies seat 1.
      snapshot = service.submitAction(GAME_ID, {
        externalId: HOST_UUID,
        targetParticipantId: seat1.id,
        definitionId: 'check',
      }).snapshot;

      expect(activeOf(snapshot)).not.toBe(seat1.id);
    });

    it('rejects a non-host caller targeting another seat', () => {
      service.claimSeat(GAME_ID, { externalId: 'bob', displayName: 'Bob' });
      const started = service.startRound(GAME_ID);
      const seat1 = started.participants.find((p) => p.seatIndex === 1)!;

      expect(() =>
        service.submitAction(GAME_ID, {
          externalId: 'bob',
          targetParticipantId: seat1.id,
          definitionId: 'check',
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects the host targeting an already-claimed seat', () => {
      service.claimSeat(GAME_ID, { externalId: 'bob', displayName: 'Bob' });
      const started = service.startRound(GAME_ID);
      const bobSeat = started.participants.find((p) => p.controller === 'bob')!;

      expect(() =>
        service.submitAction(GAME_ID, {
          externalId: HOST_UUID,
          targetParticipantId: bobSeat.id,
          definitionId: 'check',
        }),
      ).toThrow(BadRequestException);
    });
  });

  it('identifies the host by the session owner, regardless of seat claims', () => {
    expect(service.isHost(GAME_ID, HOST_UUID)).toBe(true);
    expect(service.isHost(GAME_ID, 'bob')).toBe(false);

    service.claimSeat(GAME_ID, { externalId: HOST_UUID, displayName: 'Bob' });
    expect(service.isHost(GAME_ID, HOST_UUID)).toBe(true);
  });
});
