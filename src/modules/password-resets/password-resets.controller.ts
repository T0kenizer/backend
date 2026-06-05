import * as DTOs from '@modules/password-resets/password-resets.dtos';
import { PasswordResetsService } from '@modules/password-resets/password-resets.service';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

@Controller('password-resets')
export class PasswordResetsController {
  constructor(private readonly passwordResetsService: PasswordResetsService) {}

  @Post()
  @HttpCode(204)
  public requestReset(@Body() data: DTOs.RequestResetData) {
    return this.passwordResetsService.requestReset(data.email);
  }

  @Get(':token')
  public validateToken(@Param('token') token: string) {
    return this.passwordResetsService.validateToken(token);
  }

  @Patch(':token')
  @HttpCode(204)
  public applyReset(
    @Param('token') token: string,
    @Body() data: DTOs.ApplyResetData,
  ) {
    return this.passwordResetsService.applyReset(token, data.password);
  }
}
