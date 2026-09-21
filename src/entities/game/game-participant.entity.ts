import { GameSession } from '@entities/game/game-session.entity';
import { User } from '@entities/user.entity';
import {
  Check,
  Entity,
  Enum,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core';
import { ParticipantRole } from '@tokenizer/shared/types';

/**
 * A seat of a game session. Seats are declared when the session is created
 * (`config.seating.count` rows, seat 0 being the host's) and later claimed by
 * players: `claimedBy` holds the external identity occupying the seat
 * (authenticated user uuid or anonymous client id), `user` the optional link to
 * a registered account.
 */
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

  /**
   * Explicit override; null means "no override yet" — the seat falls back to
   * the claiming user's account displayName, then the config's default seat
   * name (resolved at snapshot time, not stored here).
   */
  @Property({
    name: 'display_name',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  displayName: Nullable<string> = null;

  @Property({
    name: 'initial_balance',
    type: 'int',
    nullable: false,
  })
  initialBalance!: number;

  /** Current balance; refreshed whenever a round resolves. */
  @Property({
    name: 'balance',
    type: 'int',
    nullable: false,
  })
  balance!: number;

  /**
   * Registered account occupying the seat, once user linking lands. PLAYER
   * seats only: the host is already carried by `GameSession.owner`, so a HOST
   * row keeps this empty (enforced by a check constraint).
   */
  @ManyToOne(() => User, {
    name: 'user_uuid',
    nullable: true,
  })
  user: Nullable<User> = null;

  /** External identity occupying the seat; null while the seat is free. */
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
