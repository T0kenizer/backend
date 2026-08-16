import { CreateRequestContext, MikroORM } from '@mikro-orm/core';
import * as Constants from '@modules/files/files.constants';
import { FilesService } from '@modules/files/files.service';
import * as Types from '@modules/files/files.types';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

@Processor(Constants.FILES_QUEUE)
export class FilesConsumer extends WorkerHost {
  private readonly logger = new Logger(FilesConsumer.name);

  constructor(
    private readonly orm: MikroORM,
    private readonly filesService: FilesService,
  ) {
    super();
  }

  @CreateRequestContext()
  public async process(job: Types.FilesQueueJob): Promise<void> {
    switch (job.name) {
      case Types.FileJob.Upload: {
        const { fileUuid, contentBase64 } = job.data;

        const file = await this.filesService.getFileByUuid(fileUuid);
        await this.filesService.uploadContent(
          file,
          Buffer.from(contentBase64, 'base64'),
        );
        break;
      }
      default:
        throw new Error(
          `Unknown file job "${job.name satisfies never as string}"`,
        );
    }
  }

  @OnWorkerEvent('failed')
  public onFailed(job: Optional<Types.FilesQueueJob>, error: Error): void {
    this.logger.error(
      `File job "${job?.name}" (${job?.id}) failed on attempt ${job?.attemptsMade}`,
      error.stack,
    );
  }
}
