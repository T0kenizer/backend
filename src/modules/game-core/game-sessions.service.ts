import { GameParticipant } from '@entities/game/game-participant.entity';
import { GameSession } from '@entities/game/game-session.entity';
import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import * as Constants from '@modules/game-core/game-core.constants';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ParticipantRole, type GameConfig } from '@tokenizer/shared/types';
import { z } from 'zod';

function generateJoinCode(): string {
  const { JOIN_CODE_LENGTH, JOIN_CODE_ALPHABET } = Constants;
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code +=
      JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

/** CRUD over the persisted `GameSession` rows (the runtime lives elsewhere). */
@Injectable()
export class GameSessionsService {
  private readonly logger = new Logger(GameSessionsService.name);

  constructor(
    @InjectRepository(GameSession)
    private readonly gameSessionsRepository: EntityRepository<GameSession>,
  ) {}

  /**
   * Persists a new session and its `config.seating.seats` rows, all unclaimed
   * with no override (`displayName` stays null — the config's per-seat name is
   * a fallback resolved at snapshot time, not copied into the row). The owner
   * is the HOST — a companion who can act on behalf of any seat nobody has
   * claimed yet — not a seated player; they occupy a seat only if they
   * explicitly claim one, like anyone else.
   */
  public async create(
    owner: User,
    config: GameConfig,
  ): Promise<{ session: GameSession; participants: GameParticipant[] }> {
    const em = this.gameSessionsRepository.getEntityManager();

    const session = new GameSession();
    session.owner = owner;
    session.config = config;
    session.joinCode = await this.generateUniqueJoinCode();
    em.persist(session);

    const participants: GameParticipant[] = [];
    config.seating.seats.forEach((seat, seatIndex) => {
      const participant = new GameParticipant();
      participant.session = session;
      participant.seatIndex = seatIndex;
      participant.role =
        seatIndex === 0 ? ParticipantRole.Host : ParticipantRole.Player;
      participant.initialBalance =
        seat.initialBalance ?? config.seating.defaultInitialBalance;
      participant.balance = participant.initialBalance;

      em.persist(participant);
      participants.push(participant);
    });

    await em.flush();
    this.logger.log(
      `Created game session ${session.uuid} with ${participants.length} seats`,
    );

    return { session, participants };
  }

  public async getGameSessionByUuid(uuid: string): Promise<GameSession> {
    // WebSocket callers bypass ParseUUIDPipe, so validate here before the
    // value reaches the Postgres uuid cast.
    if (!z.uuid().safeParse(uuid).success)
      throw new NotFoundException('Game session not found');

    const session = await this.gameSessionsRepository.findOne(
      { uuid },
      { populate: ['participants'] },
    );

    if (!session) throw new NotFoundException('Game session not found');

    return session;
  }

  public async getGameSessionByJoinCode(
    joinCode: string,
  ): Promise<GameSession> {
    const session = await this.gameSessionsRepository.findOne(
      { joinCode: joinCode.toUpperCase() },
      { populate: ['participants'] },
    );

    if (!session) throw new NotFoundException('Game session not found');

    return session;
  }

  /** Generates a join code, retrying on the rare collision with an open session. */
  private async generateUniqueJoinCode(): Promise<string> {
    for (
      let attempt = 0;
      attempt < Constants.JOIN_CODE_MAX_ATTEMPTS;
      attempt++
    ) {
      const code = generateJoinCode();
      const existing = await this.gameSessionsRepository.findOne({
        joinCode: code,
      });
      if (!existing) return code;
    }
    throw new InternalServerErrorException(
      'Failed to generate a unique join code',
    );
  }

  /**
   * Stamps a seat as claimed by an external identity. `displayName` is only
   * persisted when explicitly provided — otherwise the row keeps `null` (falls
   * back to the account/config default at snapshot time). The photo override
   * itself lives in Redis, not here (`GameRoomsService`).
   */
  public async claim(
    participant: GameParticipant,
    externalId: string,
    displayName?: string,
  ): Promise<GameParticipant> {
    participant.claimedBy = externalId;
    participant.claimedAt = new Date();
    if (displayName !== undefined) participant.displayName = displayName;
    await this.gameSessionsRepository.getEntityManager().flush();

    return participant;
  }

  /**
   * Renames a seat already claimed. `undefined` leaves it unchanged; `null`
   * clears the override (falls back to the account/config default again).
   */
  public async updateSeat(
    participant: GameParticipant,
    displayName?: Nullable<string>,
  ): Promise<GameParticipant> {
    if (displayName !== undefined) participant.displayName = displayName;
    await this.gameSessionsRepository.getEntityManager().flush();

    return participant;
  }

  /** Refreshes the persisted balances from the runtime (participant → balance). */
  public async syncBalances(
    session: GameSession,
    balances: ReadonlyMap<string, number>,
  ): Promise<void> {
    for (const participant of session.participants.getItems()) {
      const balance = balances.get(participant.uuid);
      if (balance !== undefined) participant.balance = balance;
    }
    await this.gameSessionsRepository.getEntityManager().flush();
  }

  /** Stamps the session as closed for good; a closed session never re-opens. */
  public async close(session: GameSession): Promise<GameSession> {
    session.closedAt = new Date();
    await this.gameSessionsRepository.getEntityManager().flush();

    return session;
  }
}
