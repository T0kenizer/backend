import { Migration } from '@mikro-orm/migrations';

export class Migration20260817132032 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "game_sessions" add column "join_code" varchar(6) not null;`,
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
