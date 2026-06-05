import { PasswordResetToken } from '@entities/password-reset-token.entity';
import { User } from '@entities/user.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MailModule } from '@modules/mail/mail.module';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
import { PasswordResetsController } from './password-resets.controller';
import { PasswordResetsService } from './password-resets.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([PasswordResetToken, User]),
    MailModule,
    UsersModule,
  ],
  controllers: [PasswordResetsController],
  providers: [PasswordResetsService],
})
export class PasswordResetsModule {}
