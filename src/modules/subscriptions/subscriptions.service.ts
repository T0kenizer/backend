import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { ConfigService } from '@modules/config/config.service';
import { CATALOG, OFFER_METADATA_KEY } from '@modules/offers/offers.catalog';
import { planOf } from '@modules/offers/offers.utils';
import { PLAN_TIERS } from '@modules/plans/plans.constants';
import { StripeService } from '@modules/stripe/stripe.service';
import * as Constants from '@modules/subscriptions/subscriptions.constants';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { STRIPE_STATUS_PARAM } from '@tokenizer/shared/constants/subscriptions.constants';
import {
  BillingInterval,
  CheckoutStatus,
  Offer,
  Plan,
  SubscriptionStatus,
  type InvoiceStatus,
  type ListInvoicesQuery,
  type ListInvoicesResponse,
  type PaymentMethod,
  type Subscription,
} from '@tokenizer/shared/types';
import { parseEnum } from '@utils/enums.utils';
import type Stripe from 'stripe';

// A subscription, and the offer it was bought through.
interface Entitlement {
  subscription: Stripe.Subscription;
  offer: Offer;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
  ) {}

  public async createRedirectUrl(
    userUuid: string,
    offer?: string,
    redirectUrl?: string,
  ): Promise<string> {
    const user = await this.userRepository.findOneOrFail({ uuid: userUuid });
    const customer = await this.ensureCustomer(user);
    const subscriptions = await this.listSubscriptions(customer);
    const stripe = this.stripeService.client;

    const hasSubscription = subscriptions.some((subscription) =>
      this.isStarted(subscription),
    );

    // A subscriber manages their subscription from the settings instead.
    if (hasSubscription) return this.buildReturnUrl(undefined, redirectUrl);

    const prices = await this.resolvePrices(this.resolveOffer(offer));
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      // A one-time price is only billed on the first invoice.
      line_items: prices.map((price) => ({ price, quantity: 1 })),
      success_url: this.buildReturnUrl(CheckoutStatus.Success, redirectUrl),
      cancel_url: this.buildReturnUrl(CheckoutStatus.Cancelled, redirectUrl),
    });
    if (!session.url) throw new Error('Stripe returned no checkout URL');

    return session.url;
  }

  /**
   * The Stripe customer portal, where a customer changes their card or reads
   * their billing history. It returns through the callback, since a plan may
   * have changed there.
   */
  public async createPortalUrl(
    userUuid: string,
    redirectUrl?: string,
  ): Promise<string> {
    const user = await this.userRepository.findOneOrFail({ uuid: userUuid });
    if (!user.stripeCustomerId)
      throw new NotFoundException('No billing account found');

    const session =
      await this.stripeService.client.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: this.buildReturnUrl(undefined, redirectUrl),
      });

    return session.url;
  }

  // The card Stripe charges next: the customer default, else the one the
  // subscription was paid with, else any card on file.
  public async retrievePaymentMethod(userUuid: string): Promise<PaymentMethod> {
    const user = await this.userRepository.findOneOrFail({ uuid: userUuid });
    if (!user.stripeCustomerId)
      throw new NotFoundException('No payment method found');

    const stripe = this.stripeService.client;
    const customer = await stripe.customers.retrieve(user.stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    });

    let method: Nullish<string | Stripe.PaymentMethod> = customer.deleted
      ? null
      : customer.invoice_settings.default_payment_method;

    if (!method) {
      const subscriptions = await this.listSubscriptions(user.stripeCustomerId);
      method = subscriptions.find(
        ({ default_payment_method }) => default_payment_method,
      )?.default_payment_method;
    }

    if (typeof method === 'string')
      method = await stripe.paymentMethods.retrieve(method);

    if (!method) {
      const { data } = await stripe.customers.listPaymentMethods(
        user.stripeCustomerId,
        { type: 'card', limit: 1 },
      );
      method = data[0];
    }

    if (!method?.card) throw new NotFoundException('No payment method found');

    return {
      brand: method.card.brand,
      last4: method.card.last4,
      expMonth: method.card.exp_month,
      expYear: method.card.exp_year,
    };
  }

  public async completeRedirect(
    userUuid: string,
    status?: string,
    redirectUrl?: string,
  ): Promise<string> {
    const user = await this.userRepository.findOneOrFail({ uuid: userUuid });
    await this.syncPlan(user);

    const target = new URL(
      Constants.STRIPE_CALLBACK_PATH,
      this.configService.get('FRONTEND_URL'),
    );
    this.setReturnParams(target, this.parseStatus(status), redirectUrl);

    return target.toString();
  }

  public async retrieve(userUuid: string): Promise<Subscription> {
    const { subscription, offer } = await this.findCurrent(userUuid);

    return this.serialize(subscription, offer);
  }

  public async cancel(userUuid: string): Promise<Subscription> {
    const { subscription, offer } = await this.findCurrent(userUuid);

    if (subscription.cancel_at) return this.serialize(subscription, offer);

    const updated = await this.stripeService.client.subscriptions.update(
      subscription.id,
      { cancel_at_period_end: true },
    );

    return this.serialize(updated, offer);
  }

  public async resume(userUuid: string): Promise<Subscription> {
    const { subscription, offer } = await this.findCurrent(userUuid);

    if (!subscription.cancel_at) return this.serialize(subscription, offer);

    // Stripe schedules an end either at the period end or at a given date.
    const updated = await this.stripeService.client.subscriptions.update(
      subscription.id,
      subscription.cancel_at_period_end
        ? { cancel_at_period_end: false }
        : { cancel_at: '' },
    );

    return this.serialize(updated, offer);
  }

  public async listInvoices(
    userUuid: string,
    { offset, limit }: ListInvoicesQuery,
  ): Promise<ListInvoicesResponse> {
    const user = await this.userRepository.findOneOrFail({ uuid: userUuid });
    if (!user.stripeCustomerId) return { items: [], total: 0 };

    // Stripe pages with cursors and counts nothing, so the invoices are
    // fetched at once, most recent first, and sliced here.
    const invoices = (
      await this.stripeService.client.invoices
        .list({ customer: user.stripeCustomerId, limit: 100 })
        .autoPagingToArray({ limit: Constants.INVOICES_FETCH_LIMIT })
    ).filter(({ status }) => status !== 'draft');

    return {
      items: invoices.slice(offset, offset + limit).map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status as InvoiceStatus,
        amount: invoice.total,
        currency: invoice.currency,
        createdAt: new Date(invoice.created * 1000),
        hostedUrl: invoice.hosted_invoice_url ?? null,
        pdfUrl: invoice.invoice_pdf ?? null,
      })),
      total: invoices.length,
    };
  }

  public async handleEvent(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = this.stripeService.client.webhooks.constructEvent(
        rawBody,
        signature,
        this.configService.get('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }

    if (!Constants.SUBSCRIPTION_EVENTS.includes(event.type)) return;

    const { customer } = event.data.object as Stripe.Subscription;
    const stripeCustomerId =
      typeof customer === 'string' ? customer : customer.id;
    const user = await this.userRepository.findOne({ stripeCustomerId });

    if (!user) {
      this.logger.warn(
        `Stripe event ${event.id} targets unknown customer ${stripeCustomerId}`,
      );
      return;
    }

    await this.syncPlan(user);
  }

  public async syncPlan(user: User): Promise<void> {
    if (!user.stripeCustomerId) return;

    const subscriptions = await this.listSubscriptions(user.stripeCustomerId);
    const [best] = this.entitlementsOf(subscriptions);

    user.plan =
      best && this.isPaid(best.subscription) ? planOf(best.offer) : Plan.Free;
    await this.userRepository.getEntityManager().flush();
  }

  private async ensureCustomer(user: User): Promise<string> {
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const customer = await this.stripeService.client.customers.create(
      { email: user.email, metadata: { user_uuid: user.uuid } },
      { idempotencyKey: `customer-${user.uuid}` },
    );

    user.stripeCustomerId = customer.id;
    await this.userRepository.getEntityManager().flush();

    return customer.id;
  }

  private async listSubscriptions(
    customer: string,
  ): Promise<Stripe.Subscription[]> {
    const { data } = await this.stripeService.client.subscriptions.list({
      customer,
    });
    return data;
  }

  // The subscription the settings show, see `entitlementsOf`.
  private async findCurrent(userUuid: string): Promise<Entitlement> {
    const user = await this.userRepository.findOneOrFail({ uuid: userUuid });
    const subscriptions = user.stripeCustomerId
      ? await this.listSubscriptions(user.stripeCustomerId)
      : [];

    const [current] = this.entitlementsOf(subscriptions);
    if (!current) throw new NotFoundException('No subscription found');

    return current;
  }

  // What the started subscriptions grant, best first: a paying one before one
  // awaiting payment, then the highest plan.
  private entitlementsOf(subscriptions: Stripe.Subscription[]): Entitlement[] {
    return subscriptions
      .filter((subscription) => this.isStarted(subscription))
      .flatMap((subscription) => {
        const offer = this.offerOf(subscription);
        return offer ? [{ subscription, offer }] : [];
      })
      .sort(
        (a, b) =>
          Number(this.isPaid(b.subscription)) -
            Number(this.isPaid(a.subscription)) ||
          PLAN_TIERS[planOf(b.offer)] - PLAN_TIERS[planOf(a.offer)],
      );
  }

  private isStarted({ status }: Stripe.Subscription): boolean {
    return !Constants.UNSTARTED_SUBSCRIPTION_STATUSES.includes(status);
  }

  private isPaid({ status }: Stripe.Subscription): boolean {
    return Constants.PAID_SUBSCRIPTION_STATUSES.includes(status);
  }

  private serialize(
    subscription: Stripe.Subscription,
    offer: Offer,
  ): Subscription {
    const [item] = subscription.items.data;

    return {
      offer,
      plan: planOf(offer),
      status: subscription.status as SubscriptionStatus,
      price: {
        amount: item.price.unit_amount ?? 0,
        currency: item.price.currency,
        interval:
          parseEnum(
            Object.values(BillingInterval),
            item.price.recurring?.interval,
          ) ?? null,
      },
      currentPeriodEnd: new Date(item.current_period_end * 1000),
      cancelAt: subscription.cancel_at
        ? new Date(subscription.cancel_at * 1000)
        : null,
      createdAt: new Date(subscription.created * 1000),
    };
  }

  private buildReturnUrl(
    status: Optional<CheckoutStatus>,
    redirectUrl?: string,
  ): string {
    const target = new URL(this.configService.get('STRIPE_CALLBACK_URL'));
    this.setReturnParams(target, status, redirectUrl);

    return target.toString();
  }

  private setReturnParams(
    target: URL,
    status: Optional<CheckoutStatus>,
    redirectUrl?: string,
  ): void {
    if (status) target.searchParams.set(STRIPE_STATUS_PARAM, status);

    const sanitized = this.sanitizeRedirectUrl(redirectUrl);
    if (sanitized)
      target.searchParams.set(Constants.STRIPE_REDIRECT_URL_PARAM, sanitized);
  }

  // The offer stamped on the price by the sync, which a superseded price keeps
  // while its lookup key moves on.
  private offerOf(subscription: Stripe.Subscription): Optional<Offer> {
    const [item] = subscription.items.data;

    return parseEnum(
      Object.values(Offer),
      item?.price.metadata[OFFER_METADATA_KEY],
    );
  }

  // Stripe price ids of an offer, in the order the catalog declares them.
  private async resolvePrices(offer: Offer): Promise<string[]> {
    const lookupKeys = CATALOG[offer].prices.map(({ lookupKey }) => lookupKey);
    const { data } = await this.stripeService.client.prices.list({
      lookup_keys: lookupKeys,
      active: true,
    });

    return lookupKeys.map((lookupKey) => {
      const price = data.find(({ lookup_key }) => lookup_key === lookupKey);
      // Never synced, or archived to close the offer.
      if (!price) throw new Error(`No active Stripe price for ${lookupKey}`);

      return price.id;
    });
  }

  // An unknown offer falls back to the regular one.
  private resolveOffer(offer?: string): Offer {
    return parseEnum(Object.values(Offer), offer) ?? Constants.DEFAULT_OFFER;
  }

  private parseStatus(status?: string): Optional<CheckoutStatus> {
    return parseEnum(Object.values(CheckoutStatus), status);
  }

  private sanitizeRedirectUrl(redirectUrl?: unknown): Optional<string> {
    if (typeof redirectUrl !== 'string') return undefined;

    const normalized = redirectUrl.replaceAll('\\', '/');
    if (!normalized.startsWith('/') || normalized.startsWith('//'))
      return undefined;

    return normalized;
  }
}
