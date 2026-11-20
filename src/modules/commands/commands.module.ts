import { CreateSuperUserCommand } from '@commands/create-superuser.command';
import { StripeCommandsModule } from '@commands/stripe-commands.module';
import { isStripeEnabled } from '@modules/stripe/stripe.utils';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

@Module({
  imports: [
    UsersModule,
    ConditionalModule.registerWhen(StripeCommandsModule, isStripeEnabled),
  ],
  providers: [CreateSuperUserCommand],
})
export class CommandsModule {}
