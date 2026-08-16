import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { AccountConfirmationsModule } from '@modules/account-confirmations/account-confirmations.module';
import { AccountDeletionsModule } from '@modules/account-deletions/account-deletions.module';
import { CommandsModule } from '@modules/commands/commands.module';
import { ConfigModule } from '@modules/config/config.module';
import { ConfigService } from '@modules/config/config.service';
import { FilesModule } from '@modules/files/files.module';
import { HealthController } from '@modules/health.controller';
import { MailModule } from '@modules/mail/mail.module';
import { PasswordResetsModule } from '@modules/password-resets/password-resets.module';
import { RedisModule } from '@modules/redis/redis.module';
import { RedisQueueService } from '@modules/redis/services/redis-queue.service';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { UsersModule } from '@modules/users/users.module';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ZodSerializerInterceptor } from 'nestjs-zod';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisQueueService],
      useFactory: (redisQueue: RedisQueueService) => ({
        connection: redisQueue.bullConnection,
      }),
    }),
    MikroOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        driver: PostgreSqlDriver,
        host: config.get('POSTGRES_HOST'),
        port: config.get('POSTGRES_PORT'),
        user: config.get('POSTGRES_USER'),
        password: config.get('POSTGRES_PASSWORD'),
        dbName: config.get('POSTGRES_DB'),
        autoLoadEntities: true,
      }),
    }),
    CommandsModule,
    ConfigModule,
    MailModule,
    RedisModule,
    SessionsModule,
    UsersModule,
    FilesModule,
    PasswordResetsModule,
    AccountDeletionsModule,
    AccountConfirmationsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }],
})
export class AppModule {}
