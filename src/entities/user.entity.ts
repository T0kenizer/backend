import {
  Entity,
  Enum,
  Filter,
  Index,
  PrimaryKey,
  Property,
  type Opt,
} from '@mikro-orm/core';
import * as Constants from '@tokenizer/shared/constants/users.constants';
import { UserRole } from '@tokenizer/shared/types';

@Entity({
  tableName: 'users',
})
@Index({
  name: 'idx_users_username',
  expression:
    'CREATE UNIQUE INDEX "idx_users_username" ON "users" ("username") WHERE "deleted_at" IS NULL',
})
@Index({
  name: 'idx_users_display_name',
  properties: ['displayName'],
})
@Index({
  name: 'idx_users_email',
  expression:
    'CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email") WHERE "deleted_at" IS NULL',
})
@Index({
  name: 'idx_users_google_id',
  expression:
    'CREATE UNIQUE INDEX "idx_users_google_id" ON "users" ("google_id") WHERE "deleted_at" IS NULL',
})
@Filter({
  name: 'notDeleted',
  cond: { deletedAt: null },
  default: true,
})
export class User {
  @PrimaryKey({
    name: 'uuid',
    type: 'uuid',
    defaultRaw: 'gen_random_uuid()',
  })
  readonly uuid: string = crypto.randomUUID();

  @Property({
    name: 'username',
    type: 'varchar',
    length: Constants.USERNAME_MAX_LENGTH,
    nullable: false,
  })
  username!: string;

  @Property({
    name: 'display_name',
    type: 'varchar',
    length: Constants.DISPLAY_NAME_MAX_LENGTH,
    nullable: true,
  })
  displayName?: Opt<string>;

  @Property({
    name: 'email',
    type: 'varchar',
    length: Constants.EMAIL_MAX_LENGTH,
    nullable: false,
  })
  email!: string;

  @Property({ name: 'password', type: 'varchar', nullable: true })
  password?: Opt<string>;

  @Property({
    name: 'google_id',
    type: 'varchar',
    length: Constants.GOOGLE_ID_MAX_LENGTH,
    nullable: true,
  })
  googleId?: Opt<string>;

  @Property({
    name: 'avatar_url',
    type: 'varchar',
    length: Constants.AVATAR_URL_MAX_LENGTH,
    nullable: true,
  })
  avatarUrl?: Opt<string>;

  @Enum({
    name: 'role',
    items: () => UserRole,
    nativeEnumName: 'user_role',
    nullable: false,
    default: UserRole.User,
  })
  role!: Opt<UserRole>;

  @Property({
    name: 'created_at',
    type: 'timestamp with time zone',
    nullable: false,
    defaultRaw: 'now()',
  })
  readonly createdAt: Opt<Date> = new Date();

  @Property({
    name: 'updated_at',
    type: 'timestamp with time zone',
    nullable: false,
    defaultRaw: 'now()',
    onUpdate: () => new Date(),
  })
  updatedAt: Opt<Date> = new Date();

  @Property({
    name: 'deleted_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  deletedAt?: Opt<Date>;
}
