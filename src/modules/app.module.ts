import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { CommandsModule } from '@modules/commands/commands.module';
import { ConfigModule } from '@modules/config/config.module';
import { ConfigService } from '@modules/config/config.service';
import { RedisModule } from '@modules/redis/redis.module';
import { SessionsModule } from '@modules/sessions/sessions.module';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ZodSerializerInterceptor } from 'nestjs-zod';
import { HealthController } from './health.controller';
import { PasswordResetsModule } from './password-resets/password-resets.module';

@Module({
  imports: [
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
    RedisModule,
    SessionsModule,
    UsersModule,
    PasswordResetsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }],
})
export class AppModule {}
