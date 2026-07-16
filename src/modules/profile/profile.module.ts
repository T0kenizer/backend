import { MailModule } from '@modules/mail/mail.module';
import { RedisModule } from '@modules/redis/redis.module';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [UsersModule, RedisModule, MailModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
