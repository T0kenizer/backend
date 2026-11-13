import { ConfigService } from '@modules/config/config.service';
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  public readonly client: Stripe;
  public readonly isLive: boolean;

  constructor(protected readonly configService: ConfigService) {
    const secretKey = this.configService.get('STRIPE_SECRET_KEY');

    this.client = new Stripe(secretKey);
    this.isLive = /^[a-z]+_live_/.test(secretKey);
  }
}
