import { Migration } from '@mikro-orm/migrations';

export class Migration20260818050536 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "game_participants" drop constraint "game_participants_photo_uuid_foreign";`,
    );

    this.addSql(`drop index "idx_game_participants_photo_uuid";`);
    this.addSql(`alter table "game_participants" drop column "photo_uuid";`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "game_participants" add column "photo_uuid" uuid null;`,
    );
    this.addSql(
      `alter table "game_participants" add constraint "game_participants_photo_uuid_foreign" foreign key ("photo_uuid") references "files" ("uuid") on update cascade on delete set null;`,
    );
    this.addSql(
      `create index "idx_game_participants_photo_uuid" on "game_participants" ("photo_uuid");`,
    );
  }
}
