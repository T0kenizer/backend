import { Migration } from '@mikro-orm/migrations';

export class Migration20260817084748 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create type "game_participant_role" as enum ('HOST', 'PLAYER');`,
    );
    this.addSql(`drop index "idx_game_participants_identifier";`);

    this.addSql(
      `alter table "game_participants" add column "seat_index" int not null, add column "role" "game_participant_role" not null, add column "display_name" varchar(60) null, add column "initial_balance" int not null, add column "balance" int not null, add column "user_uuid" uuid null;`,
    );
    this.addSql(
      `alter table "game_participants" add constraint "game_participants_user_uuid_foreign" foreign key ("user_uuid") references "users" ("uuid") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "game_participants" rename column "identifier" to "claimed_by";`,
    );
    this.addSql(
      `alter table "game_participants" add constraint "uq_game_participants_session_seat" unique ("session_uuid", "seat_index");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "game_participants" drop constraint "game_participants_user_uuid_foreign";`,
    );

    this.addSql(
      `alter table "game_participants" drop constraint "uq_game_participants_session_seat";`,
    );
    this.addSql(
      `alter table "game_participants" drop column "seat_index", drop column "role", drop column "display_name", drop column "initial_balance", drop column "balance", drop column "user_uuid";`,
    );

    this.addSql(
      `alter table "game_participants" rename column "claimed_by" to "identifier";`,
    );
    this.addSql(
      `create index "idx_game_participants_identifier" on "game_participants" ("identifier");`,
    );

    this.addSql(`drop type "game_participant_role";`);
  }
}
