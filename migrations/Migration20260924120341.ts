import { Migration } from '@mikro-orm/migrations';

export class Migration20260924120341 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index "idx_game_sessions_stale";`);

    this.addSql(
      `alter table "game_sessions" alter column "created_at" drop default;`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "created_at" type timestamptz using ("created_at"::timestamptz);`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "last_activity_at" drop default;`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "last_activity_at" type timestamptz using ("last_activity_at"::timestamptz);`,
    );

    this.addSql(
      `alter table "game_participants" drop constraint chk_game_participants_host_has_no_user;`,
    );

    this.addSql(
      `alter table "game_participants" add column "avatar_uuid" uuid null;`,
    );
    this.addSql(
      `alter table "game_participants" add constraint "game_participants_avatar_uuid_foreign" foreign key ("avatar_uuid") references "files" ("uuid") on update cascade on delete set null;`,
    );
    this.addSql(
      `create index "idx_game_participants_avatar_uuid" on "game_participants" ("avatar_uuid");`,
    );
    this.addSql(
      `alter table "game_participants" add constraint chk_game_participants_host_has_no_user check(role != 'HOST' or user_uuid is null);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "game_participants" drop constraint "game_participants_avatar_uuid_foreign";`,
    );

    this.addSql(`drop index "idx_game_participants_avatar_uuid";`);
    this.addSql(
      `alter table "game_participants" drop constraint chk_game_participants_host_has_no_user;`,
    );
    this.addSql(`alter table "game_participants" drop column "avatar_uuid";`);

    this.addSql(
      `alter table "game_participants" add constraint chk_game_participants_host_has_no_user check((role <> 'HOST'::game_participant_role) OR (user_uuid IS NULL));`,
    );

    this.addSql(
      `alter table "game_sessions" alter column "last_activity_at" type timestamptz(6) using ("last_activity_at"::timestamptz(6));`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "last_activity_at" set default now();`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "created_at" type timestamptz(6) using ("created_at"::timestamptz(6));`,
    );
    this.addSql(
      `alter table "game_sessions" alter column "created_at" set default now();`,
    );
    this.addSql(
      `CREATE INDEX idx_game_sessions_stale ON public.game_sessions USING btree (status, last_activity_at) WHERE (closed_at IS NULL);`,
    );
  }
}
