import { PlansController } from '@modules/plans/plans.controller';
import { PlansService } from '@modules/plans/plans.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
