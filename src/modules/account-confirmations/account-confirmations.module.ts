import { AccountConfirmationToken } from '@entities/tokens/account-confirmation-token.entity';
import { User } from '@entities/user.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MailModule } from '@modules/mail/mail.module';
import { Module } from '@nestjs/common';
import { AccountConfirmationsController } from './account-confirmations.controller';
import { AccountConfirmationsService } from './account-confirmations.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([AccountConfirmationToken, User]),
    MailModule,
  ],
  controllers: [AccountConfirmationsController],
  providers: [AccountConfirmationsService],
  exports: [AccountConfirmationsService],
})
export class AccountConfirmationsModule {}
