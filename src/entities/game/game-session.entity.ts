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
import { isGameOver } from '@tokenizer/shared/utils/games.utils';

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

  @Property({
    name: 'config',
    type: 'jsonb',
    nullable: false,
  })
  config!: GameConfig;

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
    nullable: true,
    deleteRule: 'set null',
  })
  owner: Nullable<User> = null;

  @OneToMany(() => GameParticipant, (participant) => participant.session)
  participants = new Collection<GameParticipant>(this);

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

  public get isOpen(): boolean {
    return this.closedAt === null && !isGameOver(this.status);
  }
}
