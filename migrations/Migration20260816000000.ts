import { Migration } from '@mikro-orm/migrations';

export class Migration20260816000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create type "file_status" as enum ('PENDING', 'PROCESSING', 'READY', 'FAILED');`,
    );
    this.addSql(
      `create table "files" ("uuid" uuid not null default gen_random_uuid(), "bucket_key" varchar(255) not null, "bucket_name" varchar(255) not null, "original_filename" varchar(255) not null, "mime_type" varchar(255) not null, "size_bytes" int not null, "checksum_sha256" varchar(255) null, "status" "file_status" not null default 'PENDING', "created_by_uuid" uuid null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "files_pkey" primary key ("uuid"));`,
    );
    this.addSql(
      `alter table "files" add constraint "uq_files_bucket_name_key" unique ("bucket_name", "bucket_key");`,
    );
    this.addSql(
      `create index "idx_files_checksum" on "files" ("checksum_sha256");`,
    );
    this.addSql(`create index "idx_files_status" on "files" ("status");`);
    this.addSql(
      `create index "idx_files_created_by_uuid" on "files" ("created_by_uuid");`,
    );
    this.addSql(
      `alter table "files" add constraint "files_created_by_uuid_foreign" foreign key ("created_by_uuid") references "users" ("uuid") on update cascade on delete set null;`,
    );

    // Uploaded files replace external avatar URLs, so the old column goes away
    // (Google profile photos are no longer stored).
    this.addSql(`alter table "users" drop column "avatar_url";`);
    this.addSql(`alter table "users" add column "avatar_uuid" uuid null;`);
    this.addSql(
      `alter table "users" add constraint "users_avatar_uuid_foreign" foreign key ("avatar_uuid") references "files" ("uuid") on update cascade on delete set null;`,
    );
    this.addSql(
      `create index "idx_users_avatar_uuid" on "users" ("avatar_uuid");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "users" drop constraint "users_avatar_uuid_foreign";`,
    );
    this.addSql(`alter table "users" drop column "avatar_uuid";`);
    this.addSql(
      `alter table "users" add column "avatar_url" varchar(2048) null;`,
    );

    this.addSql(`drop table if exists "files" cascade;`);

    this.addSql(`drop type "file_status";`);
  }
}
