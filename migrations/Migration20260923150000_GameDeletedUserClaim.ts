import { Migration } from '@mikro-orm/migrations';

/**
 * Keeps a game readable once an account is erased.
 *
 * `game_participants.claimed_by` carries who holds a seat — null while it was
 * never claimed, a user uuid, or an anonymous token — so deleting an account
 * must leave a fourth answer there rather than fall back to one of the first
 * three. A trigger stamps the marker as the row's foreign key drops to null,
 * which the foreign key alone cannot do: `on delete set null` only reaches the
 * column it constrains.
 *
 * It matches on both columns because they answer at different times.
 * `claimed_by` is what seat claiming writes today; `user_uuid` is the link user
 * accounts will hang off once seat-to-account linking lands, and is unwritten
 * until then.
 *
 * A session's owner simply goes to null: an ownerless table is a meaningful
 * state, a seat held by nobody is not.
 */
const DELETED_USER_CLAIM = 'deleted_user';

export class Migration20260923150000_GameDeletedUserClaim extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create or replace function mark_participants_user_deleted()
      returns trigger
      language plpgsql
      as $$
      begin
        update "game_participants"
           set "claimed_by" = '${DELETED_USER_CLAIM}'
         where "claimed_by" = old."uuid"::text
            or "user_uuid" = old."uuid";
        return old;
      end;
      $$;
    `);
    this.addSql(`
      create trigger trg_users_mark_participants_deleted
      before delete on "users"
      for each row
      execute function mark_participants_user_deleted();
    `);

    this.addSql(
      `alter table "game_participants" drop constraint "game_participants_user_uuid_foreign";`,
    );
    this.addSql(
      `alter table "game_participants" add constraint "game_participants_user_uuid_foreign" foreign key ("user_uuid") references "users" ("uuid") on update cascade on delete set null;`,
    );

    this.addSql(
      `alter table "game_sessions" alter column "owner_uuid" drop not null;`,
    );
    this.addSql(
      `alter table "game_sessions" drop constraint "game_sessions_owner_uuid_foreign";`,
    );
    this.addSql(
      `alter table "game_sessions" add constraint "game_sessions_owner_uuid_foreign" foreign key ("owner_uuid") references "users" ("uuid") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "game_sessions" drop constraint "game_sessions_owner_uuid_foreign";`,
    );
    this.addSql(
      `alter table "game_sessions" add constraint "game_sessions_owner_uuid_foreign" foreign key ("owner_uuid") references "users" ("uuid") on update cascade;`,
    );
    // Sessions orphaned while the column was nullable have no owner to give
    // back, so they are what stands between here and the old NOT NULL.
    this.addSql(`delete from "game_sessions" where "owner_uuid" is null;`);
    this.addSql(
      `alter table "game_sessions" alter column "owner_uuid" set not null;`,
    );

    this.addSql(
      `alter table "game_participants" drop constraint "game_participants_user_uuid_foreign";`,
    );
    this.addSql(
      `alter table "game_participants" add constraint "game_participants_user_uuid_foreign" foreign key ("user_uuid") references "users" ("uuid") on update cascade;`,
    );

    this.addSql(
      `drop trigger if exists trg_users_mark_participants_deleted on "users";`,
    );
    this.addSql(`drop function if exists mark_participants_user_deleted();`);
    this.addSql(
      `update "game_participants" set "claimed_by" = null where "claimed_by" = '${DELETED_USER_CLAIM}';`,
    );
  }
}
