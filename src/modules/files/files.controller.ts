import { wrap } from '@mikro-orm/core';
import * as DTOs from '@modules/files/files.dtos';
import { FilesService } from '@modules/files/files.service';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import {
  Controller,
  FileTypeValidator,
  Get,
  Headers,
  HttpStatus,
  MaxFileSizeValidator,
  NotFoundException,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '@tokenizer/shared/constants/files.constants';
import { FileStatus } from '@tokenizer/shared/types';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

const ALLOWED_MIME_TYPES_REGEX = new RegExp(
  `^(${ALLOWED_MIME_TYPES.join('|')})$`,
);

@Controller('files')
@UseGuards(AuthenticatedGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ZodSerializerDto(DTOs.CreateFileResponse)
  public async create(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES }),
          // Checks the magic numbers of the actual content, so a renamed
          // executable is rejected no matter what the client declares.
          new FileTypeValidator({ fileType: ALLOWED_MIME_TYPES_REGEX }),
          // Also checks the declared mime type, since it is what gets stored
          // and served back as Content-Type.
          new FileTypeValidator({
            fileType: ALLOWED_MIME_TYPES_REGEX,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    upload: Express.Multer.File,
    @Query() query: DTOs.CreateFileQuery,
    @Req() req: Request,
  ) {
    const file = await this.filesService.create(upload, req.user!, query.mode);
    return wrap(file).toObject();
  }

  @Get(':uuid')
  @ZodSerializerDto(DTOs.RetrieveFileResponse)
  public async retrieve(@Param('uuid', ParseUUIDPipe) uuid: string) {
    const file = await this.filesService.getFileByUuid(uuid);
    return wrap(file).toObject();
  }

  @Get(':uuid/content')
  public async retrieveContent(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Headers('if-none-match') ifNoneMatch: Optional<string>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Optional<StreamableFile>> {
    const file = await this.filesService.getFileByUuid(uuid);

    const status: FileStatus = file.status;
    if (status !== FileStatus.Ready)
      throw new NotFoundException('File content not available');

    // The content behind a uuid never changes, so clients can cache it for as
    // long as they keep the session.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

    if (file.checksumSha256) {
      const etag = `"${file.checksumSha256}"`;
      res.setHeader('ETag', etag);

      if (ifNoneMatch === etag) {
        res.status(HttpStatus.NOT_MODIFIED);
        return;
      }
    }

    return new StreamableFile(this.filesService.getContentStream(file), {
      type: file.mimeType,
      length: file.sizeBytes,
      disposition: `inline; filename="${file.originalFilename.replace(/["\\]/g, '')}"`,
    });
  }
}
