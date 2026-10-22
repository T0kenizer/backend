import { Migration } from '@mikro-orm/migrations';

export class Migration20261014065015_AddUserSettings extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "users" add column "password_changed_at" timestamptz null;`,
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

    this.addSql(`alter table "users" drop column "password_changed_at";`);
  }
}
