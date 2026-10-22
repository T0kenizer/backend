import { Migration } from '@mikro-orm/migrations';

export class Migration20261010130000_AddFounderPlan extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter type "user_plan" add value if not exists 'FOUNDER';`);
  }

  // Postgres cannot drop an enum value: founders fall back to Premium and the
  // type is rebuilt without it.
  override async down(): Promise<void> {
    this.addSql(`alter table "users" alter column "plan" drop default;`);
    this.addSql(
      `alter table "users" alter column "plan" type text using "plan"::text;`,
    );
    this.addSql(
      `update "users" set "plan" = 'PREMIUM' where "plan" = 'FOUNDER';`,
    );
    this.addSql(`drop type "user_plan";`);
    this.addSql(`create type "user_plan" as enum ('FREE', 'PREMIUM');`);
    this.addSql(
      `alter table "users" alter column "plan" type "user_plan" using "plan"::"user_plan";`,
    );
    this.addSql(`alter table "users" alter column "plan" set default 'FREE';`);
  }
}
