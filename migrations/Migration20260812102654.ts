import { Migration } from '@mikro-orm/migrations';

export class Migration20260812102654 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "account_confirmation_tokens" ("uuid" uuid not null default gen_random_uuid(), "token_hash" varchar(255) not null, "created_at" timestamptz not null default now(), "expires_at" timestamptz not null, "used_at" timestamptz null, "user_uuid" uuid not null, constraint "account_confirmation_tokens_pkey" primary key ("uuid"));`,
    );
    this.addSql(
      `create index "idx_account_confirmation_tokens_token_hash" on "account_confirmation_tokens" ("token_hash");`,
    );

    this.addSql(
      `alter table "account_confirmation_tokens" add constraint "account_confirmation_tokens_user_uuid_foreign" foreign key ("user_uuid") references "users" ("uuid") on update cascade;`,
    );

    this.addSql(
      `alter table "users" add column "confirmed_at" timestamptz null;`,
    );

    // Accounts that predate this feature never had a chance to confirm, so
    // grandfather them in rather than flagging them all as unconfirmed.
    this.addSql(`update "users" set "confirmed_at" = now();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "account_confirmation_tokens" cascade;`);

    this.addSql(`alter table "users" drop column "confirmed_at";`);
  }
}
