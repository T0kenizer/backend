import { User } from '@entities/user.entity';
import { Entity, Opt, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * Shared shape of the single-use, expiring tokens we mail to users.
 *
 * Subclasses carry the `@Entity` and `@Index` decorators along with their own
 * `user` relation, so each one owns the table and foreign key column it maps
 * to.
 */
@Entity({ abstract: true })
export abstract class Token {
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

  abstract user: User;

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
