import { Migration } from '@mikro-orm/migrations';

export class Migration20260817132032 extends Migration {
  override async up(): Promise<void> {
    // Added nullable and backfilled before the NOT NULL: a bare
    // `add column ... not null` with no default fails outright on a table that
    // already has rows, which is what stalled every database created before
    // join codes existed.
    this.addSql(
      `alter table "game_sessions" add column "join_code" varchar(6) null;`,
    );
    this.addSql(
      `update "game_sessions" set "join_code" = upper(substr(replace("uuid"::text, '-', ''), 1, 6)) where "join_code" is null;`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "join_code" set not null;`,
    );
    this.addSql(
      `alter table "game_sessions" add constraint "game_sessions_join_code_unique" unique ("join_code");`,
    );

    this.addSql(
      `alter table "game_participants" drop constraint chk_game_participants_host_has_no_user;`,
    );

    this.addSql(
      `alter table "game_participants" add constraint chk_game_participants_host_has_no_user check(role != 'HOST' or user_uuid is null);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "game_participants" drop constraint chk_game_participants_host_has_no_user;`,
    );

    this.addSql(
      `alter table "game_participants" add constraint chk_game_participants_host_has_no_user check((role <> 'HOST'::game_participant_role) OR (user_uuid IS NULL));`,
    );

    this.addSql(
      `alter table "game_sessions" drop constraint "game_sessions_join_code_unique";`,
    );
    this.addSql(`alter table "game_sessions" drop column "join_code";`);
  }
}
