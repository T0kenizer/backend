import { Migration } from '@mikro-orm/migrations';

export class Migration20260816142443 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "game_sessions" ("uuid" uuid not null default gen_random_uuid(), "config" jsonb not null, "owner_uuid" uuid not null, "closed_at" timestamptz null, constraint "game_sessions_pkey" primary key ("uuid"));`);

    this.addSql(`create table "game_participants" ("uuid" uuid not null default gen_random_uuid(), "session_uuid" uuid not null, "identifier" varchar(255) null, "claimed_at" timestamptz null, constraint "game_participants_pkey" primary key ("uuid"));`);
    this.addSql(`create index "idx_game_participants_identifier" on "game_participants" ("identifier");`);

    this.addSql(`alter table "game_sessions" add constraint "game_sessions_owner_uuid_foreign" foreign key ("owner_uuid") references "users" ("uuid") on update cascade;`);

    this.addSql(`alter table "game_participants" add constraint "game_participants_session_uuid_foreign" foreign key ("session_uuid") references "game_sessions" ("uuid") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "game_participants" drop constraint "game_participants_session_uuid_foreign";`);

    this.addSql(`drop table if exists "game_sessions" cascade;`);

    this.addSql(`drop table if exists "game_participants" cascade;`);
  }

}
