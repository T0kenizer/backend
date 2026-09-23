import { Migration } from '@mikro-orm/migrations';

export class Migration20260817090500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "game_participants" add constraint chk_game_participants_host_has_no_user check(role != 'HOST' or user_uuid is null);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "game_participants" drop constraint chk_game_participants_host_has_no_user;`,
    );
  }
}
