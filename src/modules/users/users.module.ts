import { User } from '@entities/user.entity';
import { AccessGuard } from '@guards/access.guard';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { AccountConfirmationsModule } from '@modules/account-confirmations/account-confirmations.module';
import { FilesModule } from '@modules/files/files.module';
import { MailModule } from '@modules/mail/mail.module';
import { UsersController } from '@modules/users/users.controller';
import { UsersService } from '@modules/users/users.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [UsersController],
  providers: [UsersService, AccessGuard],
  exports: [UsersService],
  imports: [
    MikroOrmModule.forFeature([User]),
    FilesModule,
    MailModule,
    AccountConfirmationsModule,
  ],
})
export class UsersModule {}
