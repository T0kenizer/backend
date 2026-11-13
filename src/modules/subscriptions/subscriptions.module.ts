import { User } from '@entities/user.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { StripeModule } from '@modules/stripe/stripe.module';
import { StripeRedirectFilter } from '@modules/subscriptions/filters/stripe-redirect.filter';
import { SubscriptionsController } from '@modules/subscriptions/subscriptions.controller';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { Module } from '@nestjs/common';

@Module({
  imports: [MikroOrmModule.forFeature([User]), StripeModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, StripeRedirectFilter],
})
export class SubscriptionsModule {}
