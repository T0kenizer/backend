import { GameParticipant } from '@entities/game/game-participant.entity';
import { GameSession } from '@entities/game/game-session.entity';
import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import * as Constants from '@modules/game-core/game-core.constants';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  GameSessionStatus,
  ParticipantRole,
  type GameConfig,
} from '@tokenizer/shared/types';
import { z } from 'zod';

/**
 * CRUD over the persisted `GameSession` rows — the source of truth for
 * everything that outlives a connection. Rooms, codes and presence are built on
 * top of this, never the other way round.
 */
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
   * a fallback resolved at snapshot time, not copied into the row). Seat 0 is
   * the HOST seat; the owner claims it as part of creating the game.
   *
   * `name` is required and stored as given: a client that shows the host what
   * the table will be called is the one that must decide what an unnamed table
   * is called, or the two answers drift. The schema rejects a missing one.
   */
  public async create(
    owner: User,
    config: GameConfig,
    name: string,
  ): Promise<{ session: GameSession; participants: GameParticipant[] }> {
    const em = this.gameSessionsRepository.getEntityManager();

    const session = new GameSession();
    session.owner = owner;
    session.config = config;
    session.name = name;
    session.status = GameSessionStatus.Lobby;
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

  /**
   * Persists one further seat at an existing session.
   *
   * Unlike the rows {@link create} makes, this one carries its `displayName`:
   * the seat is not described by `config.seating.seats`, which is frozen at
   * creation, so there is no per-seat name for the snapshot to fall back to.
   */
  public async addParticipant(
    session: GameSession,
    seatIndex: number,
    displayName: string,
    initialBalance: number,
  ): Promise<GameParticipant> {
    const em = this.gameSessionsRepository.getEntityManager();

    const participant = new GameParticipant();
    participant.session = session;
    participant.seatIndex = seatIndex;
    participant.role = ParticipantRole.Player;
    participant.displayName = displayName;
    participant.initialBalance = initialBalance;
    participant.balance = initialBalance;

    em.persist(participant);
    await em.flush();

    this.logger.log(`Added seat ${seatIndex} to game session ${session.uuid}`);

    return participant;
  }

  public async getGameSessionByUuid(uuid: string): Promise<GameSession> {
    // WebSocket callers bypass ParseUUIDPipe, so validate here before the
    // value reaches the Postgres uuid cast.
    if (!z.uuid().safeParse(uuid).success)
      throw new NotFoundException('Game session not found');

    // `owner` rides along because every snapshot answers `canAddSeat`, and
    // that depends on the owner's plan. Without it the relation is a stub
    // carrying only the uuid, and reading `.plan` off it throws.
    const session = await this.gameSessionsRepository.findOne(
      { uuid },
      { populate: ['participants', 'owner'] },
    );

    if (!session) throw new NotFoundException('Game session not found');

    return session;
  }

  /**
   * Stamps a seat as claimed. `displayName` is only persisted when explicitly
   * provided — otherwise the row keeps `null` and falls back to the
   * account/config default at snapshot time.
   */
  public async claim(
    participant: GameParticipant,
    holderId: string,
    displayName?: string,
  ): Promise<GameParticipant> {
    participant.claimedBy = holderId;
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
    session.lastActivityAt = new Date();
    await this.gameSessionsRepository.getEntityManager().flush();
  }

  /** Records that something happened, which is what keeps the sweeper away. */
  public async touch(session: GameSession): Promise<void> {
    session.lastActivityAt = new Date();
    await this.gameSessionsRepository.getEntityManager().flush();
  }

  public async setStatus(
    session: GameSession,
    status: GameSessionStatus,
  ): Promise<GameSession> {
    session.status = status;
    session.lastActivityAt = new Date();
    await this.gameSessionsRepository.getEntityManager().flush();

    return session;
  }

  /**
   * Stamps the session as terminated for good. `FINISHED` is a deliberate close
   * by the host, `ABANDONED` one the lifecycle queue decided on; either way the
   * room never re-opens.
   */
  public async close(
    session: GameSession,
    status: GameSessionStatus = GameSessionStatus.Finished,
  ): Promise<GameSession> {
    session.status = status;
    session.closedAt = new Date();
    session.lastActivityAt = new Date();
    await this.gameSessionsRepository.getEntityManager().flush();

    return session;
  }

  /**
   * Sessions still marked playable that have gone quiet past the threshold.
   *
   * This is the backstop for a lifecycle job that never ran — the process died
   * between scheduling and execution, or the queue lost it. Without it such a
   * session stays `LOBBY`/`RUNNING` forever, and nothing else would ever look
   * at it again.
   */
  public async findStale(threshold: Date): Promise<GameSession[]> {
    return this.gameSessionsRepository.find(
      {
        closedAt: null,
        status: {
          $in: [GameSessionStatus.Lobby, GameSessionStatus.Running],
        },
        lastActivityAt: { $lt: threshold },
      },
      {
        populate: ['participants'],
        limit: Constants.STALE_SWEEP_BATCH_SIZE,
        orderBy: { lastActivityAt: 'ASC' },
      },
    );
  }
}
