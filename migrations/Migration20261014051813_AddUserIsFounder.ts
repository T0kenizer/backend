import { Migration } from '@mikro-orm/migrations';

export class Migration20261014051813_AddUserIsFounder extends Migration {
  // Compared as text: 'FOUNDER' was added to "user_plan" by the previous
  // migration, and Postgres refuses to use a new enum value in the transaction
  // that added it — which is the case when both run in the same batch.
  override async up(): Promise<void> {
    this.addSql(
      `alter table "users" add column "is_founder" boolean not null default false;`,
    );
    this.addSql(
      `update "users" set "is_founder" = true where "plan"::text = 'FOUNDER';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "is_founder";`);
  }
}
