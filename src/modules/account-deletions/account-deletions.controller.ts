import { User } from '@entities/user.entity';
import * as DTOs from '@modules/account-deletions/account-deletions.dtos';
import { AccountDeletionsService } from '@modules/account-deletions/account-deletions.service';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import { SessionsService } from '@modules/sessions/sessions.service';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

@Controller('account-deletions')
@UseGuards(AuthenticatedGuard)
export class AccountDeletionsController {
  constructor(
    private readonly accountDeletionsService: AccountDeletionsService,
    private readonly sessionsService: SessionsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  public requestDeletion(@Req() req: Request) {
    return this.accountDeletionsService.requestDeletion(req.user as User);
  }

  @Get(':token')
  @ZodSerializerDto(DTOs.ValidateDeletionTokenResponse)
  public validateToken(@Param('token') token: string, @Req() req: Request) {
    return this.accountDeletionsService.validateToken(token, req.user as User);
  }

  @Delete(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async applyDeletion(
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.accountDeletionsService.applyDeletion(token, req.user as User);
    await this.sessionsService.delete(req, res);
  }
}
