import { ConfigService } from '@modules/config/config.service';
import * as Constants from '@modules/subscriptions/subscriptions.constants';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { STRIPE_ERROR_PARAM } from '@tokenizer/shared/constants/subscriptions.constants';
import { CheckoutError } from '@tokenizer/shared/types';
import type { Request, Response } from 'express';

@Injectable()
@Catch()
export class StripeRedirectFilter implements ExceptionFilter {
  private readonly logger = new Logger(StripeRedirectFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const code = this.toErrorCode(exception);
    if (code === CheckoutError.Failed)
      this.logger.error(
        'Stripe redirection failed',
        exception instanceof Error ? exception.stack : exception,
      );

    const target = new URL(
      Constants.STRIPE_CALLBACK_PATH,
      this.configService.get('FRONTEND_URL'),
    );
    target.searchParams.set(STRIPE_ERROR_PARAM, code);

    const redirectUrl = req.query[Constants.STRIPE_REDIRECT_URL_PARAM];
    if (typeof redirectUrl === 'string')
      target.searchParams.set(Constants.STRIPE_REDIRECT_URL_PARAM, redirectUrl);

    res.redirect(target.toString());
  }

  private toErrorCode(exception: unknown): CheckoutError {
    if (exception instanceof UnauthorizedException)
      return CheckoutError.Unauthenticated;
    return CheckoutError.Failed;
  }
}
