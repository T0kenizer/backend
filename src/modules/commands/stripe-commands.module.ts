import { StripeSyncCommand } from '@commands/stripe-sync.command';
import { StripeModule } from '@modules/stripe/stripe.module';
import { Module } from '@nestjs/common';

// The commands that need Stripe, registered only once it is enabled.
@Module({
  imports: [StripeModule],
  providers: [StripeSyncCommand],
})
export class StripeCommandsModule {}
