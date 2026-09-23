import { File } from '@entities/file.entity';
import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import * as Constants from '@modules/files/files.constants';
import * as Types from '@modules/files/files.types';
import { FirebaseService } from '@modules/firebase/firebase.service';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ALLOWED_MIME_TYPES } from '@tokenizer/shared/constants/files.constants';
import { FileStatus, FileUploadMode } from '@tokenizer/shared/types';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
// Loads the `Express.Multer` global augmentation shipped by @types/multer.
import 'multer';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(File)
    private readonly filesRepository: EntityRepository<File>,
    @InjectQueue(Constants.FILES_QUEUE)
    private readonly filesQueue: Types.FilesQueue,
    private readonly firebaseService: FirebaseService,
  ) {}

  public async create(
    upload: Express.Multer.File,
    createdBy: User,
    mode: FileUploadMode = FileUploadMode.Sync,
  ): Promise<File> {
    const em = this.filesRepository.getEntityManager();
    const bucket = this.firebaseService.bucket();

    const uuid = crypto.randomUUID();

    const file = this.filesRepository.create({
      uuid,
      // Keyed by uuid so two uploads of the same filename never collide.
      bucketKey: `files/${uuid}`,
      bucketName: bucket.name,
      originalFilename: upload.originalname,
      mimeType: upload.mimetype,
      sizeBytes: upload.size,
      checksumSha256: createHash('sha256').update(upload.buffer).digest('hex'),
      status: FileStatus.Pending,
      createdBy,
    });

    // Persisted before the upload so a crash mid-transfer leaves a Pending row
    // instead of an untracked object in the bucket.
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
      // An undecodable image is the client's fault, not a storage failure.
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Failed to store file content');
    }

    return file;
  }

  /**
   * Uploads the content to the bucket and tracks the status transitions.
   * Rethrows the upload error so queue workers can let the job fail.
   */
  public async uploadContent(file: File, content: Buffer): Promise<void> {
    const em = this.filesRepository.getEntityManager();

    file.status = FileStatus.Processing;
    await em.flush();

    try {
      const processed = await this.process(file, content);

      // The stored bytes differ from the upload, so the recorded size, checksum
      // and mime type must describe what the bucket actually holds (they drive
      // the Content-Length, ETag and Content-Type of the content route).
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

  /**
   * Re-encodes the image before it reaches the bucket, so anything that is not
   * pixel data (EXIF, embedded payloads) never gets stored. Every accepted
   * format is normalised to webp: the bucket then holds a single format, and
   * smaller objects than the png/jpeg originals. The returned mime type is the
   * one of the encoded bytes, so the served Content-Type stays truthful.
   */
  protected async process(
    file: File,
    content: Buffer,
  ): Promise<Types.ProcessedFile> {
    if (!ALLOWED_MIME_TYPES.includes(file.mimeType as never)) {
      throw new Error(`Unsupported mime type "${file.mimeType}"`);
    }

    // EXIF is discarded by the re-encoding, so the orientation it carries
    // must be baked into the pixels first.
    // Animations are not kept: sharp decodes the first frame only, so an
    // animated gif or webp is stored as a still image.
    const encoded = sharp(content)
      .rotate()
      .webp({ quality: Constants.WEBP_QUALITY });

    try {
      return {
        content: await encoded.toBuffer(),
        mimeType: Constants.STORED_MIME_TYPE,
      };
    } catch (error) {
      // The content passed the magic number check but cannot be decoded.
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
}
