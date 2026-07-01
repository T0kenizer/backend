import { wrap } from '@mikro-orm/core';
import * as DTOs from '@modules/users/users.dtos';
import { UsersService } from '@modules/users/users.service';
import { Body, Controller, Post } from '@nestjs/common';
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
}
