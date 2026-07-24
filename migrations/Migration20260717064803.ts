import { Migration } from '@mikro-orm/migrations';

export class Migration20260717064803 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "users" drop constraint "users_username_unique";`);
    this.addSql(`alter table "users" drop constraint "users_email_unique";`);
    this.addSql(
      `alter table "users" drop constraint "users_google_id_unique";`,
    );
    this.addSql(`drop index if exists "idx_users_username";`);
    this.addSql(`drop index if exists "idx_users_email";`);
    this.addSql(`drop index if exists "idx_users_google_id";`);
    this.addSql(
      `CREATE UNIQUE INDEX "idx_users_username" ON "users" ("username") WHERE "deleted_at" IS NULL;`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email") WHERE "deleted_at" IS NULL;`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX "idx_users_google_id" ON "users" ("google_id") WHERE "deleted_at" IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "idx_users_username";`);
    this.addSql(`drop index if exists "idx_users_email";`);
    this.addSql(`drop index if exists "idx_users_google_id";`);
    this.addSql(
      `alter table "users" add constraint "users_username_unique" unique ("username");`,
    );
    this.addSql(
      `alter table "users" add constraint "users_email_unique" unique ("email");`,
    );
    this.addSql(
      `alter table "users" add constraint "users_google_id_unique" unique ("google_id");`,
    );
  }
}
