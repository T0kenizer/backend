import { CreateSuperUserCommand } from '@commands/create-superuser.command';
import { StripeSyncCommand } from '@commands/stripe-sync.command';
import { StripeModule } from '@modules/stripe/stripe.module';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [UsersModule, StripeModule],
  providers: [CreateSuperUserCommand, StripeSyncCommand],
})
export class CommandsModule {}
