import { GameSession } from '@entities/game/game-session.entity';
import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { ConfigManager } from '@modules/game-core/config-manager';
import * as Constants from '@modules/game-core/game-core.constants';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { GameConfig } from '@tokenizer/shared/types';

/** CRUD over the persisted `GameSession` rows (the runtime lives elsewhere). */
@Injectable()
export class GameSessionsService {
  private readonly logger = new Logger(GameSessionsService.name);

  constructor(
    @InjectRepository(GameSession)
    private readonly gameSessionsRepository: EntityRepository<GameSession>,
  ) {}

  public async create(owner: User, config: GameConfig): Promise<GameSession> {
    const em = this.gameSessionsRepository.getEntityManager();

    // Not `repository.create()`: the config column hides behind a virtual
    // getter/setter pair the entity factory cannot populate.
    const session = new GameSession();
    session.owner = owner;
    session.config = ConfigManager.fromConfig(config);

    em.persist(session);
    await em.flush();
    this.logger.log(`Created game session ${session.uuid}`);

    return session;
  }

  public async getGameSessionByUuid(uuid: string): Promise<GameSession> {
    // WebSocket callers bypass ParseUUIDPipe, so validate here before the
    // value reaches the Postgres uuid cast.
    if (!Constants.UUID_PATTERN.test(uuid))
      throw new NotFoundException('Game session not found');

    const session = await this.gameSessionsRepository.findOne({ uuid });

    if (!session) throw new NotFoundException('Game session not found');

    return session;
  }

  /** Stamps the session as closed for good; a closed session never re-opens. */
  public async close(session: GameSession): Promise<GameSession> {
    session.closedAt = new Date();
    await this.gameSessionsRepository.getEntityManager().flush();

    return session;
  }
}
