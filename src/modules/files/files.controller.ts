import { wrap } from '@mikro-orm/core';
import * as DTOs from '@modules/files/files.dtos';
import { parseUploadPipe } from '@modules/files/files.pipes';
import { FilesService } from '@modules/files/files.service';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
// Loads the `Express.Multer` global augmentation shipped by @types/multer.
import 'multer';

@Controller('files')
@UseGuards(AuthenticatedGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ZodSerializerDto(DTOs.CreateFileResponse)
  public async create(
    @UploadedFile(parseUploadPipe())
    upload: Express.Multer.File,
    @Query() query: DTOs.CreateFileQuery,
    @Req() req: Request,
  ) {
    const file = await this.filesService.create(upload, req.user, query.mode);
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
