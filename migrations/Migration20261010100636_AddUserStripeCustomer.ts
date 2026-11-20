import { Migration } from '@mikro-orm/migrations';

export class Migration20261010100636_AddUserStripeCustomer extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "users" add column "stripe_customer_id" varchar(255) null;`,
    );
    this.addSql(
      `create index "idx_users_stripe_customer_id" on "users" ("stripe_customer_id");`,
    );
    this.addSql(
      `alter table "users" add constraint "users_stripe_customer_id_unique" unique ("stripe_customer_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "idx_users_stripe_customer_id";`);
    this.addSql(
      `alter table "users" drop constraint "users_stripe_customer_id_unique";`,
    );
    this.addSql(`alter table "users" drop column "stripe_customer_id";`);
  }
}
