import { AllowSelf, Roles } from '@decorators/access.decorators';
import { AccessGuard } from '@guards/access.guard';
import { wrap } from '@mikro-orm/core';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import * as DTOs from '@modules/users/users.dtos';
import { UsersService } from '@modules/users/users.service';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ADMIN_ROLES } from '@tokenizer/shared/constants/users.constants';
import { ZodSerializerDto } from 'nestjs-zod';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ZodSerializerDto(DTOs.CreateUserResponse)
  public async create(@Body() data: DTOs.CreateUserData) {
    const user = await this.usersService.create(data);
    return wrap(user).toObject();
  }

  @Patch(':uuid')
  @UseGuards(AuthenticatedGuard, AccessGuard)
  @AllowSelf('uuid')
  @Roles(...ADMIN_ROLES)
  @ZodSerializerDto(DTOs.PartialUpdateUserResponse)
  public async partialUpdate(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() data: DTOs.PartialUpdateUserData,
  ) {
    const target = await this.usersService.getUserByUuid(uuid);
    const user = await this.usersService.partialUpdate(target, data);

    return wrap(user).toObject();
  }
}
