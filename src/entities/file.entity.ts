import { User } from '@entities/user.entity';
import {
  Entity,
  Enum,
  Filter,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
  type Opt,
  type Ref,
} from '@mikro-orm/core';
import { FileStatus } from '@tokenizer/shared/types';

@Entity({
  tableName: 'files',
})
@Unique({
  name: 'uq_files_bucket_name_key',
  properties: ['bucketName', 'bucketKey'],
})
@Filter({
  name: 'notDeleted',
  cond: { deletedAt: null },
  default: true,
})
export class File {
  @PrimaryKey({
    name: 'uuid',
    type: 'uuid',
    defaultRaw: 'gen_random_uuid()',
  })
  readonly uuid: string = crypto.randomUUID();

  @Property({
    type: 'varchar',
    nullable: false,
  })
  bucketKey!: string;

  @Property({
    type: 'varchar',
    nullable: false,
  })
  bucketName!: string;

  @Property({
    type: 'varchar',
    nullable: false,
  })
  readonly originalFilename!: string;

  @Property({
    type: 'varchar',
    nullable: false,
  })
  readonly mimeType!: string;

  @Property({
    type: 'int',
    nullable: false,
  })
  // Not readonly: re-encoding before the bucket upload changes the size.
  sizeBytes!: number;

  @Property({
    type: 'varchar',
    nullable: true,
  })
  @Index({ name: 'idx_files_checksum' })
  checksumSha256?: Opt<string>;

  @Enum({
    name: 'status',
    items: () => FileStatus,
    nativeEnumName: 'file_status',
    nullable: false,
    default: FileStatus.Pending,
  })
  @Index({ name: 'idx_files_status' })
  status!: Opt<FileStatus>;

  @ManyToOne(() => User, {
    name: 'created_by_uuid',
    nullable: true,
    deleteRule: 'set null',
    ref: true,
  })
  @Index({
    name: 'idx_files_created_by_uuid',
  })
  createdBy?: Ref<User>;

  @Property({
    name: 'created_at',
    type: 'timestamp with time zone',
    nullable: false,
    defaultRaw: 'now()',
  })
  readonly createdAt: Opt<Date> = new Date();

  @Property({
    name: 'updated_at',
    type: 'timestamp with time zone',
    nullable: false,
    defaultRaw: 'now()',
    onUpdate: () => new Date(),
  })
  updatedAt: Opt<Date> = new Date();

  @Property({
    name: 'deleted_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  deletedAt?: Opt<Date>;
}
