import { Migration } from '@mikro-orm/migrations';

/**
 * Moves the join code out of the database and gives sessions a real lifecycle.
 *
 * The 6-digit code is ephemeral by design: it lives in Redis under a sliding
 * TTL and resolves to the session uuid. Keeping a `join_code` column meant a
 * code could never expire without a write, and a unique index on it meant a
 * long-finished game kept a code hostage forever.
 */
export class Migration20260921120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create type "game_session_status" as enum ('LOBBY', 'RUNNING', 'FINISHED', 'ABANDONED');`,
    );

    this.addSql(
      `alter table "game_sessions" add column "name" varchar(60) null;`,
    );
    // Existing rows predate the column; the old code is the best label we have.
    this.addSql(
      `update "game_sessions" set "name" = coalesce("join_code", 'Game');`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "name" set not null;`,
    );

    this.addSql(
      `alter table "game_sessions" add column "status" "game_session_status" not null default 'LOBBY';`,
    );
    // A row already stamped closed is finished, whatever it was doing before.
    this.addSql(
      `update "game_sessions" set "status" = 'FINISHED' where "closed_at" is not null;`,
    );

    this.addSql(
      `alter table "game_sessions" add column "created_at" timestamptz not null default now();`,
    );
    this.addSql(
      `alter table "game_sessions" add column "last_activity_at" timestamptz not null default now();`,
    );

    this.addSql(
      `alter table "game_sessions" drop constraint if exists "game_sessions_join_code_unique";`,
    );
    this.addSql(`alter table "game_sessions" drop column "join_code";`);

    // The stale sweeper scans exactly this predicate on a schedule.
    this.addSql(
      `create index "idx_game_sessions_stale" on "game_sessions" ("status", "last_activity_at") where "closed_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "idx_game_sessions_stale";`);
    this.addSql(
      `alter table "game_sessions" add column "join_code" varchar(6) null;`,
    );
    // The codes themselves are gone for good: they only ever lived in Redis.
    this.addSql(
      `update "game_sessions" set "join_code" = upper(substr(replace("uuid"::text, '-', ''), 1, 6));`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "join_code" set not null;`,
    );
    this.addSql(
      `alter table "game_sessions" add constraint "game_sessions_join_code_unique" unique ("join_code");`,
    );

    this.addSql(`alter table "game_sessions" drop column "last_activity_at";`);
    this.addSql(`alter table "game_sessions" drop column "created_at";`);
    this.addSql(`alter table "game_sessions" drop column "status";`);
    this.addSql(`alter table "game_sessions" drop column "name";`);
    this.addSql(`drop type "game_session_status";`);
  }
}
