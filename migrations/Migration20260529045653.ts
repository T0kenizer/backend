import { Migration } from '@mikro-orm/migrations';

export class Migration20260529045653 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create type "user_role" as enum ('USER', 'ADMIN', 'OWNER');`);
    this.addSql(
      `create table "users" ("uuid" uuid not null default gen_random_uuid(), "username" varchar(64) not null, "display_name" varchar(64) null, "email" varchar(320) not null, "password" varchar(255) null, "google_id" varchar(64) null, "avatar_url" varchar(2048) null, "role" "user_role" not null default 'USER', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "users_pkey" primary key ("uuid"));`,
    );
    this.addSql(
      `alter table "users" add constraint "users_username_unique" unique ("username");`,
    );
    this.addSql(
      `alter table "users" add constraint "users_email_unique" unique ("email");`,
    );
    this.addSql(
      `alter table "users" add constraint "users_google_id_unique" unique ("google_id");`,
    );
    this.addSql(`create index "idx_users_google_id" on "users" ("google_id");`);
    this.addSql(`create index "idx_users_email" on "users" ("email");`);
    this.addSql(
      `create index "idx_users_display_name" on "users" ("display_name");`,
    );
    this.addSql(`create index "idx_users_username" on "users" ("username");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "users" cascade;`);

    this.addSql(`drop type "user_role";`);
  }
}
