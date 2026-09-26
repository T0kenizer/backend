import { RedisModule } from '@modules/redis/redis.module';
import { SessionSerializer } from '@modules/sessions/session.serializer';
import { SessionsController } from '@modules/sessions/sessions.controller';
import { SessionsService } from '@modules/sessions/sessions.service';
import { GoogleStrategy } from '@modules/sessions/strategies/google.strategy';
import { LocalStrategy } from '@modules/sessions/strategies/local.strategy';
import { UserSessionsController } from '@modules/sessions/user-sessions.controller';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

@Module({
  imports: [
    UsersModule,
    RedisModule,
    PassportModule.register({ session: true }),
  ],
  controllers: [SessionsController, UserSessionsController],
  providers: [
    SessionSerializer,
    GoogleStrategy,
    LocalStrategy,
    SessionsService,
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
