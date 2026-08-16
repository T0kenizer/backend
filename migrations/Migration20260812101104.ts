import { Migration } from '@mikro-orm/migrations';

export class Migration20260812101104 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "account_deletion_tokens" ("uuid" uuid not null default gen_random_uuid(), "token_hash" varchar(255) not null, "created_at" timestamptz not null default now(), "expires_at" timestamptz not null, "used_at" timestamptz null, "user_uuid" uuid not null, constraint "account_deletion_tokens_pkey" primary key ("uuid"));`,
    );
    this.addSql(
      `create index "idx_account_deletion_tokens_token_hash" on "account_deletion_tokens" ("token_hash");`,
    );

    this.addSql(
      `alter table "account_deletion_tokens" add constraint "account_deletion_tokens_user_uuid_foreign" foreign key ("user_uuid") references "users" ("uuid") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "account_deletion_tokens" cascade;`);
  }
}
