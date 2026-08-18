import type { GameSession } from '@entities/game/game-session.entity';
import type { User } from '@entities/user.entity';
import type { EntityRepository } from '@mikro-orm/core';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import { GameSessionsService } from '@modules/game-core/game-sessions.service';
import { NotFoundException } from '@nestjs/common';
import { ParticipantRole } from '@tokenizer/shared/types';

const GAME_UUID = '11111111-1111-4111-8111-111111111111';
const OWNER_UUID = '22222222-2222-4222-8222-222222222222';

describe('GameSessionsService', () => {
  let em: { persist: jest.Mock; flush: jest.Mock };
  let repository: { getEntityManager: () => typeof em; findOne: jest.Mock };
  let service: GameSessionsService;

  beforeEach(() => {
    em = { persist: jest.fn(), flush: jest.fn().mockResolvedValue(undefined) };
    repository = {
      getEntityManager: () => em,
      findOne: jest.fn().mockResolvedValue(null),
    };
    service = new GameSessionsService(
      repository as unknown as EntityRepository<GameSession>,
    );
  });

  it('persists a new session with its declared seats', async () => {
    const owner = {
      uuid: OWNER_UUID,
      username: 'owner',
      displayName: 'Owner',
    } as User;

    const { session, participants } = await service.create(
      owner,
      defaultGameConfig(),
    );

    expect(session.owner).toBe(owner);
    expect(participants).toHaveLength(4);
    // 1 session + 4 seats persisted in a single flush
    expect(em.persist).toHaveBeenCalledTimes(5);
    expect(em.flush).toHaveBeenCalledTimes(1);

    // All seats start unclaimed with no override — the config's default seat
    // name and the owner (host) are resolved elsewhere, not stored here.
    for (const [index, seat] of participants.entries()) {
      expect(seat).toMatchObject({
        seatIndex: index,
        role: index === 0 ? ParticipantRole.Host : ParticipantRole.Player,
        displayName: null,
        claimedBy: null,
        claimedAt: null,
        // A HOST row never links a user: the owner lives on `GameSession.owner`
        user: null,
        balance: 1000,
        initialBalance: 1000,
      });
      expect(seat.session).toBe(session);
    }
  });

  it('stamps a seat when it is claimed', async () => {
    const owner = { uuid: OWNER_UUID, username: 'owner' } as User;
    const { participants } = await service.create(owner, defaultGameConfig());

    const claimed = await service.claim(participants[1], 'bob', 'Bob');

    expect(claimed.claimedBy).toBe('bob');
    expect(claimed.displayName).toBe('Bob');
    expect(claimed.claimedAt).toBeInstanceOf(Date);
    expect(em.flush).toHaveBeenCalledTimes(2);
  });

  it('claiming without a displayName leaves the override unset', async () => {
    const owner = { uuid: OWNER_UUID, username: 'owner' } as User;
    const { participants } = await service.create(owner, defaultGameConfig());

    const claimed = await service.claim(participants[1], 'bob');

    expect(claimed.claimedBy).toBe('bob');
    expect(claimed.displayName).toBeNull();
  });

  describe('getGameSessionByUuid', () => {
    it('rejects malformed uuids before they reach the database', async () => {
      await expect(service.getGameSessionByUuid('nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('throws when the session does not exist', async () => {
      await expect(service.getGameSessionByUuid(GAME_UUID)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.findOne).toHaveBeenCalledWith(
        { uuid: GAME_UUID },
        { populate: ['participants'] },
      );
    });
  });

  it('stamps the session as closed', async () => {
    const session = { closedAt: null } as unknown as GameSession;

    await service.close(session);

    expect(session.closedAt).toBeInstanceOf(Date);
    expect(em.flush).toHaveBeenCalled();
  });
});
