import { wrap } from '@mikro-orm/core';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import { AUTH_COOKIE_NAME } from '@modules/sessions/sessions.constants';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import * as DTOs from './profile.dtos';
import { ProfileService } from './profile.service';

@Controller('profile')
@UseGuards(AuthenticatedGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ZodSerializerDto(DTOs.ProfileResponse)
  public get(@Req() req: Request) {
    return wrap(req.user!).toObject();
  }

  @Patch()
  @ZodSerializerDto(DTOs.ProfileResponse)
  public async update(
    @Req() req: Request,
    @Body() data: DTOs.UpdateProfileData,
  ) {
    const user = await this.profileService.update(req.user!, data);
    return wrap(user).toObject();
  }

  @Patch('/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  public changePassword(
    @Req() req: Request,
    @Body() data: DTOs.ChangePasswordData,
  ) {
    return this.profileService.changePassword(req.user!, data);
  }

  @Delete('/google')
  @ZodSerializerDto(DTOs.ProfileResponse)
  public async unlinkGoogle(@Req() req: Request) {
    const user = await this.profileService.unlinkGoogle(req.user!);
    return wrap(user).toObject();
  }

  @Post('/delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  public requestDeletion(@Req() req: Request) {
    return this.profileService.requestDeletion(req.user!);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  public async confirmDeletion(
    @Body() data: DTOs.ConfirmDeletionData,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.profileService.confirmDeletion(data.token);

    await new Promise<void>((resolve, reject) => {
      req.logout((error: Error) => {
        if (error) return reject(error);
        req.session.destroy((error: Error) => {
          if (error) return reject(error);
          res.clearCookie(AUTH_COOKIE_NAME);
          resolve();
        });
      });
    });
  }
}
