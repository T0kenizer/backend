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
import { FileStatus, FileUploadMode } from '@tokenizer/shared/types';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import sharp from 'sharp';

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

      // The stored bytes differ from the upload, so the recorded size and
      // checksum must describe what the bucket actually holds (they drive the
      // Content-Length and ETag of the content route).
      file.sizeBytes = processed.length;
      file.checksumSha256 = createHash('sha256')
        .update(processed)
        .digest('hex');

      await this.firebaseService
        .bucket(file.bucketName)
        .file(file.bucketKey)
        .save(processed, {
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
   * pixel data (EXIF, embedded payloads) never gets stored. Encoding to the
   * declared mime type also keeps the served Content-Type truthful.
   */
  protected async process(file: File, content: Buffer): Promise<Buffer> {
    // EXIF is discarded by the re-encoding, so the orientation it carries
    // must be baked into the pixels first.
    const image = sharp(content).rotate();

    let encoded: sharp.Sharp;
    switch (file.mimeType) {
      case 'image/png':
        encoded = image.png();
        break;
      case 'image/jpeg':
        encoded = image.jpeg();
        break;
      default:
        throw new Error(`Unsupported mime type "${file.mimeType}"`);
    }

    try {
      return await encoded.toBuffer();
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

  public getContentStream(file: File): Readable {
    return this.firebaseService
      .bucket(file.bucketName)
      .file(file.bucketKey)
      .createReadStream();
  }
}
