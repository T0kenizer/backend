import { GameParticipant } from '@entities/game/game-participant.entity';
import { User } from '@entities/user.entity';
import {
  Collection,
  Entity,
  Enum,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { GameSessionStatus, type GameConfig } from '@tokenizer/shared/types';

/**
 * A game session. The uuid is the only identifier that ever reaches this table:
 * the 6-digit join code is ephemeral and lives in Redis alone, so a session
 * carries no column for it — the code can expire, be re-minted, or never exist,
 * without the row knowing.
 */
@Entity({
  tableName: 'game_sessions',
})
export class GameSession {
  @PrimaryKey({
    name: 'uuid',
    type: 'uuid',
    defaultRaw: 'gen_random_uuid()',
  })
  readonly uuid: string = crypto.randomUUID();

  @Property({
    name: 'name',
    type: 'varchar',
    length: 60,
    nullable: false,
  })
  name!: string;

  /**
   * Stored as-is; validated against `gameConfigSchema` at the API boundary on
   * write and re-validated on read when a room is hydrated.
   */
  @Property({
    name: 'config',
    type: 'jsonb',
    nullable: false,
  })
  config!: GameConfig;

  /**
   * The authoritative lifecycle state. `ABANDONED` is written by the lifecycle
   * queue when a room stayed empty through its grace period (or by the stale
   * sweeper); `FINISHED` is a deliberate close by the host.
   */
  @Enum({
    name: 'status',
    items: () => GameSessionStatus,
    nativeEnumName: 'game_session_status',
    nullable: false,
    default: GameSessionStatus.Lobby,
  })
  status: GameSessionStatus = GameSessionStatus.Lobby;

  @ManyToOne(() => User, {
    name: 'owner_uuid',
    nullable: false,
  })
  owner!: User;

  @OneToMany(() => GameParticipant, (participant) => participant.session)
  participants = new Collection<GameParticipant>(this);

  /**
   * Last time anything happened in this session. The stale-session sweeper
   * reads it to close sessions whose lifecycle job was lost.
   */
  @Property({
    name: 'last_activity_at',
    type: 'timestamptz',
    nullable: false,
    onCreate: () => new Date(),
  })
  lastActivityAt: Date = new Date();

  @Property({
    name: 'created_at',
    type: 'timestamptz',
    nullable: false,
    onCreate: () => new Date(),
  })
  readonly createdAt: Date = new Date();

  @Property({
    name: 'closed_at',
    type: 'timestamptz',
    nullable: true,
  })
  closedAt: Nullable<Date> = null;

  /** Whether the session can still be joined or played. */
  public get isOpen(): boolean {
    return (
      this.closedAt === null &&
      (this.status === GameSessionStatus.Lobby ||
        this.status === GameSessionStatus.Running)
    );
  }
}
