import { File } from '@entities/file.entity';
import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import * as Constants from '@modules/files/files.constants';
import * as Types from '@modules/files/files.types';
import { FirebaseService } from '@modules/firebase/firebase.service';
import { RedisCacheService } from '@modules/redis/services/redis-cache.service';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FileStatus, FileUploadMode } from '@tokenizer/shared/types';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
// Loads the `Express.Multer` global augmentation shipped by @types/multer.
import 'multer';

function signedUrlKey(fileUuid: string): string {
  return `signed_url:${fileUuid}`;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(File)
    private readonly filesRepository: EntityRepository<File>,
    @InjectQueue(Constants.FILES_QUEUE)
    private readonly filesQueue: Types.FilesQueue,
    private readonly firebaseService: FirebaseService,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  public async create(
    upload: Express.Multer.File,
    createdBy?: User,
    mode: FileUploadMode = FileUploadMode.Sync,
  ): Promise<File> {
    const em = this.filesRepository.getEntityManager();
    const bucket = this.firebaseService.bucket();

    const uuid = crypto.randomUUID();

    const file = this.filesRepository.create({
      uuid,
      bucketKey: `files/${uuid}`,
      bucketName: bucket.name,
      originalFilename: upload.originalname,
      mimeType: upload.mimetype,
      sizeBytes: upload.size,
      checksumSha256: createHash('sha256').update(upload.buffer).digest('hex'),
      status: FileStatus.Pending,
      createdBy,
    });

    await em.flush();

    if (mode === FileUploadMode.Async) {
      await this.filesQueue.add(Types.FileJob.Upload, {
        fileUuid: file.uuid,
        contentBase64: upload.buffer.toString('base64'),
      });

      return file;
    }

    try {
      await this.uploadContent(file, upload.buffer);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Failed to store file content');
    }

    return file;
  }

  public async uploadContent(file: File, content: Buffer): Promise<void> {
    const em = this.filesRepository.getEntityManager();

    file.status = FileStatus.Processing;
    await em.flush();

    try {
      const processed = await this.process(file, content);

      file.sizeBytes = processed.content.length;
      file.checksumSha256 = createHash('sha256')
        .update(processed.content)
        .digest('hex');
      file.mimeType = processed.mimeType;

      await this.firebaseService
        .bucket(file.bucketName)
        .file(file.bucketKey)
        .save(processed.content, {
          contentType: file.mimeType,
          resumable: false,
        });
      file.status = FileStatus.Ready;
    } catch (error) {
      file.status = FileStatus.Failed;
      this.logger.error(
        `Failed to upload file ${file.uuid} to bucket ${file.bucketName}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await em.flush();
    }
  }

  protected async process(
    file: File,
    content: Buffer,
  ): Promise<Types.ProcessedFile> {
    switch (file.mimeType) {
      case 'image/png':
      case 'image/jpeg':
      case 'image/webp':
      case 'image/gif':
        return this.encodeWebp(content);
      default:
        return { content, mimeType: file.mimeType };
    }
  }

  private async encodeWebp(content: Buffer): Promise<Types.ProcessedFile> {
    const encoded = sharp(content)
      .rotate()
      .webp({ quality: Constants.WEBP_QUALITY });

    try {
      return {
        content: await encoded.toBuffer(),
        mimeType: 'image/webp',
      };
    } catch (error) {
      throw new BadRequestException('Invalid image content', { cause: error });
    }
  }

  public async findFileByUuid(uuid: string): Promise<Nullable<File>> {
    return this.filesRepository.findOne({ uuid });
  }

  public async getFileByUuid(uuid: string): Promise<File> {
    const file = await this.findFileByUuid(uuid);

    if (!file) throw new NotFoundException('File not found');

    return file;
  }

  public async buildSignedUrl(
    file: File,
    options: Partial<Types.SignedUrlOptions> = {},
  ): Promise<string> {
    const [url] = await this.firebaseService
      .bucket(file.bucketName)
      .file(file.bucketKey)
      .getSignedUrl({
        expires: Date.now() + Constants.SIGNED_URL_TTL_MS,
        ...options,
        action: 'read',
      });

    return url;
  }

  public async buildCachedSignedUrl(file: File): Promise<string> {
    const cached = await this.readSignedUrl(file.uuid);
    if (cached) return cached;

    const url = await this.buildSignedUrl(file);

    return this.rememberSignedUrl(file.uuid, url);
  }

  private async readSignedUrl(fileUuid: string): Promise<Nullable<string>> {
    try {
      return await this.redisCacheService.client.get(signedUrlKey(fileUuid));
    } catch (error) {
      this.logger.warn(`Signed URL cache read failed: ${String(error)}`);
      return null;
    }
  }

  private async rememberSignedUrl(
    fileUuid: string,
    url: string,
  ): Promise<string> {
    try {
      const claimed = await this.redisCacheService.client.set(
        signedUrlKey(fileUuid),
        url,
        { NX: true, PX: Constants.SIGNED_URL_CACHE_TTL_MS },
      );
      if (claimed) return url;

      return (await this.readSignedUrl(fileUuid)) ?? url;
    } catch (error) {
      this.logger.warn(`Signed URL cache write failed: ${String(error)}`);
      return url;
    }
  }
}
