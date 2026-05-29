import { configSchema } from '@modules/config/config.schema';
import { ConfigService } from '@modules/config/config.service';
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Env vars are injected by docker-compose (`env_file`), so we read them
      // straight from `process.env` rather than loading any .env file here.
      validate: (config) => {
        const result = configSchema.safeParse(config);
        if (!result.success)
          throw new Error('Invalid configuration: ' + result.error.message);
        return result.data;
      },
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
