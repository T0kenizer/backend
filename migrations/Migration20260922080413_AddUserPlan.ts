import { Migration } from '@mikro-orm/migrations';

export class Migration20260922080413_AddUserPlan extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create type "user_plan" as enum ('FREE', 'PREMIUM');`);
    this.addSql(
      `alter table "users" add column "plan" "user_plan" not null default 'FREE';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "plan";`);
    this.addSql(`drop type "user_plan";`);
  }
}
