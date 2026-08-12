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
} from '@nestjs/common';
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

  @Get(':token')
  @ZodSerializerDto(DTOs.ValidateConfirmationTokenResponse)
  public validateToken(@Param('token') token: string) {
    return this.accountConfirmationsService.validateToken(token);
  }

  @Patch(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  public applyConfirmation(@Param('token') token: string) {
    return this.accountConfirmationsService.applyConfirmation(token);
  }
}
