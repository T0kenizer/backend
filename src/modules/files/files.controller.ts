import { wrap } from '@mikro-orm/core';
import * as DTOs from '@modules/files/files.dtos';
import { FilesService } from '@modules/files/files.service';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import {
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '@tokenizer/shared/constants/files.constants';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
// Loads the `Express.Multer` global augmentation shipped by @types/multer.
import 'multer';

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
          new FileTypeValidator({ fileType: ALLOWED_MIME_TYPES_REGEX }),
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
    return {
      ...wrap(file).toObject(),
      url: await this.filesService.buildSignedUrl(file),
    };
  }

  @Get(':uuid')
  @ZodSerializerDto(DTOs.RetrieveFileResponse)
  public async retrieve(@Param('uuid', ParseUUIDPipe) uuid: string) {
    const file = await this.filesService.getFileByUuid(uuid);
    return {
      ...wrap(file).toObject(),
      url: await this.filesService.buildSignedUrl(file),
    };
  }
}
