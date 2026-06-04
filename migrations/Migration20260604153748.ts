import { Migration } from '@mikro-orm/migrations';

export class Migration20260604153748 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "password_reset_tokens" ("uuid" uuid not null default gen_random_uuid(), "token_hash" varchar(255) not null, "user_uuid" uuid not null, "created_at" timestamptz not null default now(), "expires_at" timestamptz not null, "used_at" timestamptz null, constraint "password_reset_tokens_pkey" primary key ("uuid"));`,
    );
    this.addSql(
      `create index "idx_password_reset_tokens_token_hash" on "password_reset_tokens" ("token_hash");`,
    );

    this.addSql(
      `alter table "password_reset_tokens" add constraint "password_reset_tokens_user_uuid_foreign" foreign key ("user_uuid") references "users" ("uuid") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "password_reset_tokens" cascade;`);
  }
}
