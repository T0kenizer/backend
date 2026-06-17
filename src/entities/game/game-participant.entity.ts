import { GameSession } from '@entities/game/game-session.entity';
import {
  Entity,
  Index,
  ManyToOne,
  type Opt,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';

@Entity({
  tableName: 'game_participants',
})
@Index({
  name: 'idx_game_participants_identifier',
  properties: ['identifier'],
})
export class GameParticipant {
  @PrimaryKey({
    name: 'uuid',
    type: 'uuid',
    defaultRaw: 'gen_random_uuid()',
  })
  readonly uuid: string = crypto.randomUUID();

  @ManyToOne(() => GameSession, {
    name: 'session_uuid',
    nullable: false,
  })
  session!: GameSession;

  @Property({
    name: 'identifier',
    type: 'varchar',
    nullable: true,
  })
  identifier!: Opt<string>;

  @Property({
    name: 'claimed_at',
    type: 'timestamptz',
    nullable: true,
  })
  claimedAt: Nullable<Date> = null;
}
