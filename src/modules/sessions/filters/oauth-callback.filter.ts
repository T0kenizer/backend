import { ConfigService } from '@modules/config/config.service';
import {
  OAUTH_CALLBACK_PATH,
  OAuthErrorCode,
} from '@modules/sessions/sessions.constants';
import { GoogleEmailNotVerifiedException } from '@modules/sessions/sessions.exceptions';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
@Catch()
export class OAuthCallbackFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthCallbackFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const code = this.toErrorCode(exception, req);
    if (code === 'failed')
      this.logger.error(
        'Google sign-in failed',
        exception instanceof Error ? exception.stack : exception,
      );

    const target = new URL(
      OAUTH_CALLBACK_PATH,
      this.configService.get('FRONTEND_URL'),
    );
    target.searchParams.set('error', code);
    res.redirect(target.toString());
  }

  private toErrorCode(exception: unknown, req: Request): OAuthErrorCode {
    if (req.query.error === 'access_denied') return 'access_denied';
    if (exception instanceof GoogleEmailNotVerifiedException)
      return 'unverified_email';
    return 'failed';
  }
}
