import * as DTOs from '@modules/offers/offers.dtos';
import { OffersService } from '@modules/offers/offers.service';
import { Controller, Get } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';

@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  @ZodSerializerDto(DTOs.ListOffersResponse)
  public list() {
    return this.offersService.list();
  }
}
