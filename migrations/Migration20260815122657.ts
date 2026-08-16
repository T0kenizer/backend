import { Migration } from '@mikro-orm/migrations';

export class Migration20260815122657 extends Migration {
  override async up(): Promise<void> {
    // Accounts soft-deleted before anonymization existed still hold their real
    // username/email, which keeps the unique constraints occupied and blocks
    // the person from ever signing up again. Scrub them the same way
    // AccountDeletionsService.applyDeletion now does.
    this.addSql(
      `update "users" set
        "username" = 'deleted_' || "uuid",
        "email" = 'deleted_' || "uuid" || '@deleted.invalid',
        "google_id" = null,
        "password" = null,
        "display_name" = null,
        "avatar_url" = null
      where "deleted_at" is not null;`,
    );
  }

  override async down(): Promise<void> {
    // The scrubbed personal data is gone for good; nothing to restore.
  }
}
