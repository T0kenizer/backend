import { AllowSelf, Roles } from '@decorators/access.decorators';
import { AccessGuard } from '@guards/access.guard';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import * as DTOs from '@modules/sessions/sessions.dtos';
import { SessionsService } from '@modules/sessions/sessions.service';
import { UsersService } from '@modules/users/users.service';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ADMIN_ROLES } from '@tokenizer/shared/constants/users.constants';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

@Controller('users/:uuid/sessions')
export class UserSessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @UseGuards(AuthenticatedGuard, AccessGuard)
  @AllowSelf('uuid')
  @Roles(...ADMIN_ROLES)
  @ZodSerializerDto(DTOs.ListSessionsResponse)
  public async list(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Query() query: DTOs.ListSessionsQuery,
    @Req() req: Request,
  ) {
    const user = await this.usersService.getUserByUuid(uuid);

    return this.sessionsService.list(user.uuid, query, req);
  }
}
