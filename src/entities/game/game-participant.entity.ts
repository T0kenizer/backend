import { File } from '@entities/file.entity';
import { GameSession } from '@entities/game/game-session.entity';
import { User } from '@entities/user.entity';
import {
  Check,
  Entity,
  Enum,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
  type Ref,
} from '@mikro-orm/core';
import { ParticipantRole } from '@tokenizer/shared/types';

@Entity({
  tableName: 'game_participants',
})
@Unique({
  name: 'uq_game_participants_session_seat',
  properties: ['session', 'seatIndex'],
})
@Check({
  name: 'chk_game_participants_host_has_no_user',
  expression: `role != 'HOST' or user_uuid is null`,
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
    name: 'seat_index',
    type: 'int',
    nullable: false,
  })
  seatIndex!: number;

  @Enum({
    name: 'role',
    items: () => ParticipantRole,
    nativeEnumName: 'game_participant_role',
    nullable: false,
  })
  role!: ParticipantRole;

  @Property({
    name: 'display_name',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  displayName: Nullable<string> = null;

  @ManyToOne(() => File, {
    name: 'avatar_uuid',
    nullable: true,
    deleteRule: 'set null',
    ref: true,
  })
  @Index({ name: 'idx_game_participants_avatar_uuid' })
  avatar?: Ref<File>;

  @Property({
    name: 'initial_balance',
    type: 'int',
    nullable: false,
  })
  initialBalance!: number;

  @Property({
    name: 'balance',
    type: 'int',
    nullable: false,
  })
  balance!: number;

  @ManyToOne(() => User, {
    name: 'user_uuid',
    nullable: true,
    deleteRule: 'set null',
  })
  user: Nullable<User> = null;

  @Property({
    name: 'claimed_by',
    type: 'varchar',
    nullable: true,
  })
  claimedBy: Nullable<string> = null;

  @Property({
    name: 'claimed_at',
    type: 'timestamptz',
    nullable: true,
  })
  claimedAt: Nullable<Date> = null;
}
