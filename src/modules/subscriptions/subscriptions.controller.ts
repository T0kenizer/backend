import { User } from '@entities/user.entity';
import { AuthenticatedGuard } from '@modules/sessions/authenticated.guard';
import { StripeRedirectFilter } from '@modules/subscriptions/filters/stripe-redirect.filter';
import * as Constants from '@modules/subscriptions/subscriptions.constants';
import * as DTOs from '@modules/subscriptions/subscriptions.dtos';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  STRIPE_OFFER_PARAM,
  STRIPE_STATUS_PARAM,
} from '@tokenizer/shared/constants/subscriptions.constants';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('/current')
  @ZodSerializerDto(DTOs.RetrieveSubscriptionResponse)
  @UseGuards(AuthenticatedGuard)
  public retrieve(@Req() req: Request) {
    return this.subscriptionsService.retrieve((req.user as User).uuid);
  }

  @Post('/current/cancel')
  @ZodSerializerDto(DTOs.CancelSubscriptionResponse)
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.OK)
  public cancel(@Req() req: Request) {
    return this.subscriptionsService.cancel((req.user as User).uuid);
  }

  @Post('/current/resume')
  @ZodSerializerDto(DTOs.ResumeSubscriptionResponse)
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.OK)
  public resume(@Req() req: Request) {
    return this.subscriptionsService.resume((req.user as User).uuid);
  }

  @Get('/invoices')
  @ZodSerializerDto(DTOs.ListInvoicesResponse)
  @UseGuards(AuthenticatedGuard)
  public listInvoices(
    @Query() query: DTOs.ListInvoicesQuery,
    @Req() req: Request,
  ) {
    return this.subscriptionsService.listInvoices(
      (req.user as User).uuid,
      query,
    );
  }

  @Get('/payment-method')
  @ZodSerializerDto(DTOs.RetrievePaymentMethodResponse)
  @UseGuards(AuthenticatedGuard)
  public retrievePaymentMethod(@Req() req: Request) {
    return this.subscriptionsService.retrievePaymentMethod(
      (req.user as User).uuid,
    );
  }

  @Get('/portal')
  @UseFilters(StripeRedirectFilter)
  @UseGuards(AuthenticatedGuard)
  public async portal(
    @Req() req: Request,
    @Res() res: Response,
    @Query(Constants.STRIPE_REDIRECT_URL_PARAM) redirectUrl?: string,
  ): Promise<void> {
    const target = await this.subscriptionsService.createPortalUrl(
      (req.user as User).uuid,
      redirectUrl,
    );
    res.redirect(HttpStatus.SEE_OTHER, target);
  }

  @Get('/stripe')
  @UseFilters(StripeRedirectFilter)
  @UseGuards(AuthenticatedGuard)
  public async stripe(
    @Req() req: Request,
    @Res() res: Response,
    @Query(STRIPE_OFFER_PARAM) offer?: string,
    @Query(Constants.STRIPE_REDIRECT_URL_PARAM) redirectUrl?: string,
  ): Promise<void> {
    const target = await this.subscriptionsService.createRedirectUrl(
      (req.user as User).uuid,
      offer,
      redirectUrl,
    );
    res.redirect(HttpStatus.SEE_OTHER, target);
  }

  @Get('/stripe/callback')
  @UseFilters(StripeRedirectFilter)
  @UseGuards(AuthenticatedGuard)
  public async stripeCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query(STRIPE_STATUS_PARAM) status?: string,
    @Query(Constants.STRIPE_REDIRECT_URL_PARAM) redirectUrl?: string,
  ): Promise<void> {
    const target = await this.subscriptionsService.completeRedirect(
      (req.user as User).uuid,
      status,
      redirectUrl,
    );
    res.redirect(target);
  }

  @Post('/stripe/webhook')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  public async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!req.rawBody || !signature)
      throw new BadRequestException('Missing Stripe signature');

    await this.subscriptionsService.handleEvent(req.rawBody, signature);

    return { received: true };
  }
}
