import { OffersController } from '@modules/offers/offers.controller';
import { OffersService } from '@modules/offers/offers.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [OffersController],
  providers: [OffersService],
})
export class OffersModule {}
