import { AccountDeletionToken } from '@entities/tokens/account-deletion-token.entity';
import { User } from '@entities/user.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MailModule } from '@modules/mail/mail.module';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { Module } from '@nestjs/common';
import { AccountDeletionsController } from './account-deletions.controller';
import { AccountDeletionsService } from './account-deletions.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([AccountDeletionToken, User]),
    MailModule,
    SessionsModule,
  ],
  controllers: [AccountDeletionsController],
  providers: [AccountDeletionsService],
})
export class AccountDeletionsModule {}
