import * as DTOs from '@modules/plans/plans.dtos';
import { PlansService } from '@modules/plans/plans.service';
import { Controller, Get } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ZodSerializerDto(DTOs.ListPlansResponse)
  public list() {
    return this.plansService.list();
  }
}
