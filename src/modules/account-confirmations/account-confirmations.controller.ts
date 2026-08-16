import * as DTOs from '@modules/account-confirmations/account-confirmations.dtos';
import { AccountConfirmationsService } from '@modules/account-confirmations/account-confirmations.service';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

@Controller('account-confirmations')
export class AccountConfirmationsController {
  constructor(
    private readonly accountConfirmationsService: AccountConfirmationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  public requestConfirmation(@Body() data: DTOs.RequestConfirmationData) {
    return this.accountConfirmationsService.requestConfirmation(data.email);
  }

  // No AuthenticatedGuard here: confirmation must work for freshly signed-up
  // users without a session. The service still rejects tokens that belong to
  // someone other than the connected user, when there is one.
  @Get(':token')
  @ZodSerializerDto(DTOs.ValidateConfirmationTokenResponse)
  public validateToken(@Param('token') token: string, @Req() req: Request) {
    return this.accountConfirmationsService.validateToken(token, req.user);
  }

  @Patch(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  public applyConfirmation(@Param('token') token: string, @Req() req: Request) {
    return this.accountConfirmationsService.applyConfirmation(token, req.user);
  }
}
