import { GameParticipant } from '@entities/game/game-participant.entity';
import { User } from '@entities/user.entity';
import {
  Collection,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import type { GameConfig } from '@tokenizer/shared/types';

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

  /**
   * Short human-shareable code identifying the room (Socket.IO room name, Redis
   * occupancy keys) — distinct from the DB primary key. Generated at creation
   * and unique among open sessions.
   */
  @Property({
    name: 'join_code',
    type: 'varchar',
    length: 6,
    unique: true,
    nullable: false,
  })
  joinCode!: string;

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

  @ManyToOne(() => User, {
    name: 'owner_uuid',
    nullable: false,
  })
  owner!: User;

  @OneToMany(() => GameParticipant, (participant) => participant.session)
  participants = new Collection<GameParticipant>(this);

  @Property({
    name: 'closed_at',
    type: 'timestamptz',
    nullable: true,
  })
  closedAt: Nullable<Date> = null;
}
