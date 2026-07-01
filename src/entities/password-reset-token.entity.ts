import { User } from '@entities/user.entity';
import {
  Entity,
  Index,
  ManyToOne,
  Opt,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';

@Entity({
  tableName: 'password_reset_tokens',
})
@Index({
  name: 'idx_password_reset_tokens_token_hash',
  properties: ['tokenHash'],
})
export class PasswordResetToken {
  @PrimaryKey({
    name: 'uuid',
    type: 'uuid',
    defaultRaw: 'gen_random_uuid()',
  })
  readonly uuid: string = crypto.randomUUID();

  @Property({
    name: 'token_hash',
    type: 'varchar',
    nullable: false,
  })
  readonly tokenHash!: string;

  @ManyToOne(() => User, {
    name: 'user_uuid',
    nullable: false,
  })
  user!: User;

  @Property({
    name: 'created_at',
    type: 'timestamp with time zone',
    nullable: false,
    defaultRaw: 'now()',
  })
  readonly createdAt: Opt<Date> = new Date();

  @Property({
    name: 'expires_at',
    type: 'timestamp with time zone',
    nullable: false,
  })
  readonly expiresAt!: Date;

  @Property({
    name: 'used_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  usedAt?: Opt<Date>;
}
