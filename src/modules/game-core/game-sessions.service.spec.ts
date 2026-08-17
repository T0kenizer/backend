import type { GameSession } from '@entities/game/game-session.entity';
import type { User } from '@entities/user.entity';
import type { EntityRepository } from '@mikro-orm/core';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import { GameSessionsService } from '@modules/game-core/game-sessions.service';
import { NotFoundException } from '@nestjs/common';

const GAME_UUID = '11111111-1111-4111-8111-111111111111';

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

  it('persists a new session owned by the given user', async () => {
    const owner = { uuid: 'owner' } as User;

    const session = await service.create(owner, defaultGameConfig());

    expect(session.owner).toBe(owner);
    expect(session.config.config).toEqual(defaultGameConfig());
    expect(em.persist).toHaveBeenCalledWith(session);
    expect(em.flush).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed uuids before they reach the database', async () => {
    await expect(service.getGameSessionByUuid('not-a-uuid')).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('throws when the session does not exist', async () => {
    await expect(service.getGameSessionByUuid(GAME_UUID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('stamps closedAt on close', async () => {
    const session = { closedAt: null } as GameSession;

    await service.close(session);

    expect(session.closedAt).toBeInstanceOf(Date);
    expect(em.flush).toHaveBeenCalledTimes(1);
  });
});
