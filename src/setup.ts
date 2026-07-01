import { LoggingInterceptor } from '@interceptors/logging.interceptor';
import { ConfigService } from '@modules/config/config.service';
import { RedisService } from '@modules/redis/redis.service';
import { AUTH_COOKIE_NAME } from '@modules/sessions/sessions.constants';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { RedisStore } from 'connect-redis';
import session from 'express-session';
import { ZodSerializationException, ZodValidationPipe } from 'nestjs-zod';
import passport from 'passport';

@Catch(HttpException)
class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: HttpException, host: ArgumentsHost) {
    if (exception instanceof ZodSerializationException) {
      const zodError = exception.getZodError() as { message: string };
      this.logger.error(`ZodSerializationException: ${zodError.message}`);
    }

    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    httpAdapter.reply(
      ctx.getResponse(),
      exception.getResponse(),
      exception.getStatus(),
    );
  }
}

export function setupApp(app: INestApplication): INestApplication {
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter(app.get(HttpAdapterHost)));
  app.useGlobalInterceptors(new LoggingInterceptor());

  const configService = app.get(ConfigService);
  const redisService = app.get(RedisService);

  app.enableCors({
    origin:
      configService.get('NODE_ENV') === 'production'
        ? 'https://tokenizer.fr'
        : true,
    credentials: true,
  });

  app.use(
    session({
      name: AUTH_COOKIE_NAME,
      store: new RedisStore({
        client: redisService.client,
        prefix: 'sess:',
      }),
      secret: configService.get('SECRET_KEY'),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: configService.get('NODE_ENV') === 'production',
        signed: true,
        sameSite:
          configService.get('NODE_ENV') === 'production' ? 'strict' : 'lax',
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  return app;
}
