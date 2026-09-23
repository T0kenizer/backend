import { Migration } from '@mikro-orm/migrations';

const TABLES = [
  'account_confirmation_tokens',
  'account_deletion_tokens',
  'password_reset_tokens',
] as const;

export class Migration20260923134906_AddTokenDeleteCascade extends Migration {
  override async up(): Promise<void> {
    for (const table of TABLES) {
      this.addSql(
        `alter table "${table}" drop constraint "${table}_user_uuid_foreign";`,
      );
      this.addSql(
        `alter table "${table}" add constraint "${table}_user_uuid_foreign" foreign key ("user_uuid") references "users" ("uuid") on update cascade on delete cascade;`,
      );
    }
  }

  override async down(): Promise<void> {
    for (const table of TABLES) {
      this.addSql(
        `alter table "${table}" drop constraint "${table}_user_uuid_foreign";`,
      );
      this.addSql(
        `alter table "${table}" add constraint "${table}_user_uuid_foreign" foreign key ("user_uuid") references "users" ("uuid") on update cascade;`,
      );
    }
  }
}
