import { StripeService } from '@modules/stripe/stripe.service';
import { Module } from '@nestjs/common';

@Module({
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
