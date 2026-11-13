import type { User } from '@entities/user.entity';
import type { EntityRepository } from '@mikro-orm/core';
import type { ConfigService } from '@modules/config/config.service';
import type { StripeService } from '@modules/stripe/stripe.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Offer, Plan } from '@tokenizer/shared/types';

const USER_UUID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = 'cus_123';

interface FakeSubscription {
  status: string;
  offer?: string;
  cancel_at?: number;
  cancel_at_period_end?: boolean;
}

// 2026-11-14T00:00:00Z and 2026-10-14T00:00:00Z, in Stripe seconds.
const PERIOD_END = 1794614400;
const CREATED = 1791936000;

const fakeSubscription = ({
  status,
  offer = Offer.PremiumMonthly,
  cancel_at,
  cancel_at_period_end = false,
}: FakeSubscription) => {
  const isFounder = offer === (Offer.FounderLifetime as string);

  return {
    id: `sub_${offer.toLowerCase()}`,
    status,
    created: CREATED,
    cancel_at: cancel_at ?? null,
    cancel_at_period_end,
    items: {
      data: [
        {
          current_period_end: PERIOD_END,
          price: {
            unit_amount: isFounder ? 0 : 199,
            currency: 'eur',
            recurring: { interval: isFounder ? 'year' : 'month' },
            metadata: { offer },
          },
        },
      ],
    },
  };
};

// Active Stripe prices, by lookup key.
const PRICES: Record<string, string> = {
  premium_monthly: 'price_123',
  founder_subscription: 'price_zero',
  founder_lifetime: 'price_once',
};

const CONFIG = {
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  STRIPE_CALLBACK_URL: 'http://localhost:3000/subscriptions/stripe/callback',
  FRONTEND_URL: 'http://localhost:8080',
};

function build(
  userData: Partial<User> = {},
  subscriptions: FakeSubscription[] = [],
  prices: Record<string, string> = PRICES,
) {
  const user = {
    uuid: USER_UUID,
    email: 'player@tokenizer.fr',
    plan: Plan.Free,
    ...userData,
  } as User;

  const flush = jest.fn().mockResolvedValue(undefined);
  const userRepository = {
    findOneOrFail: jest.fn().mockResolvedValue(user),
    findOne: jest.fn().mockResolvedValue(user),
    getEntityManager: () => ({ flush }),
  };
  const client = {
    customers: { create: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) },
    subscriptions: {
      list: jest.fn().mockResolvedValue({
        data: subscriptions.map(fakeSubscription),
      }),
      update: jest.fn((id: string, params: Partial<FakeSubscription>) => {
        const subscription = subscriptions.find(
          ({ offer = Offer.PremiumMonthly }) =>
            `sub_${offer.toLowerCase()}` === id,
        )!;
        return Promise.resolve(
          fakeSubscription({ ...subscription, ...params }),
        );
      }),
    },
    invoices: { list: jest.fn() },
    prices: {
      list: jest.fn().mockResolvedValue({
        data: Object.entries(prices).map(([lookup_key, id]) => ({
          id,
          lookup_key,
        })),
      }),
    },
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://stripe/checkout' }),
      },
    },
    webhooks: { constructEvent: jest.fn() },
  };
  const service = new SubscriptionsService(
    userRepository as unknown as EntityRepository<User>,
    { client } as unknown as StripeService,
    {
      get: (key: string) => (CONFIG as Record<string, unknown>)[key],
    } as unknown as ConfigService,
  );

  return { service, user, userRepository, client, flush };
}

describe('SubscriptionsService', () => {
  describe('createRedirectUrl', () => {
    it('sends a user without subscription to Checkout', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID });

      const url = await service.createRedirectUrl(
        USER_UUID,
        Offer.PremiumMonthly,
        '/settings',
      );

      expect(url).toBe('https://stripe/checkout');
      expect(client.prices.list).toHaveBeenCalledWith({
        lookup_keys: ['premium_monthly'],
        active: true,
      });
      expect(client.checkout.sessions.create).toHaveBeenCalledWith({
        mode: 'subscription',
        customer: CUSTOMER_ID,
        line_items: [{ price: 'price_123', quantity: 1 }],
        success_url: `${CONFIG.STRIPE_CALLBACK_URL}?status=success&redirectUrl=%2Fsettings`,
        cancel_url: `${CONFIG.STRIPE_CALLBACK_URL}?status=cancelled&redirectUrl=%2Fsettings`,
      });
    });

    it('sends a subscriber back without a checkout', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID }, [
        { status: 'past_due' },
      ]);

      const url = await service.createRedirectUrl(
        USER_UUID,
        Offer.FounderLifetime,
        '/settings/subscription',
      );

      expect(url).toBe(
        `${CONFIG.STRIPE_CALLBACK_URL}?redirectUrl=%2Fsettings%2Fsubscription`,
      );
      expect(client.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('sells the founder offer as a free subscription plus a one-time fee', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID });

      await service.createRedirectUrl(USER_UUID, Offer.FounderLifetime);

      expect(client.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          line_items: [
            { price: 'price_zero', quantity: 1 },
            { price: 'price_once', quantity: 1 },
          ],
        }),
      );
    });

    it('refuses an offer whose price is no longer active', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID }, [], {
        founder_subscription: 'price_zero',
      });

      await expect(
        service.createRedirectUrl(USER_UUID, Offer.FounderLifetime),
      ).rejects.toThrow('No active Stripe price for founder_lifetime');
      expect(client.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('falls back to the regular offer for an unknown offer', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID });

      await service.createRedirectUrl(USER_UUID, 'GOLD');

      expect(client.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: 'price_123', quantity: 1 }],
        }),
      );
    });

    it('treats a never-completed subscription as no subscription', async () => {
      const { service } = build({ stripeCustomerId: CUSTOMER_ID }, [
        { status: 'incomplete' },
      ]);

      await expect(service.createRedirectUrl(USER_UUID)).resolves.toBe(
        'https://stripe/checkout',
      );
    });

    it('creates the Stripe customer once and stores its id', async () => {
      const { service, client, user, flush } = build();

      await service.createRedirectUrl(USER_UUID);

      expect(client.customers.create).toHaveBeenCalledWith(
        { email: user.email, metadata: { user_uuid: USER_UUID } },
        { idempotencyKey: `customer-${USER_UUID}` },
      );
      expect(user.stripeCustomerId).toBe(CUSTOMER_ID);
      expect(flush).toHaveBeenCalled();

      await service.createRedirectUrl(USER_UUID);

      expect(client.customers.create).toHaveBeenCalledTimes(1);
    });

    it.each(['https://evil.com', '//evil.com', '\\\\evil.com'])(
      'drops the external redirect url %s',
      async (redirectUrl) => {
        const { service, client } = build({ stripeCustomerId: CUSTOMER_ID });

        await service.createRedirectUrl(USER_UUID, undefined, redirectUrl);

        expect(client.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            success_url: `${CONFIG.STRIPE_CALLBACK_URL}?status=success`,
          }),
        );
      },
    );
  });

  describe('retrieve', () => {
    it('describes the current subscription', async () => {
      const { service } = build({ stripeCustomerId: CUSTOMER_ID }, [
        { status: 'active' },
      ]);

      await expect(service.retrieve(USER_UUID)).resolves.toEqual({
        offer: Offer.PremiumMonthly,
        plan: Plan.Premium,
        status: 'active',
        price: { amount: 199, currency: 'eur', interval: 'month' },
        currentPeriodEnd: new Date(PERIOD_END * 1000),
        cancelAt: null,
        createdAt: new Date(CREATED * 1000),
      });
    });

    it('prefers a paying subscription, then the highest plan', async () => {
      const { service } = build({ stripeCustomerId: CUSTOMER_ID }, [
        { status: 'past_due', offer: Offer.FounderLifetime },
        { status: 'active', offer: Offer.PremiumMonthly },
        { status: 'incomplete', offer: Offer.FounderLifetime },
      ]);

      await expect(service.retrieve(USER_UUID)).resolves.toMatchObject({
        offer: Offer.PremiumMonthly,
      });
    });

    it.each<[Partial<User>, FakeSubscription[]]>([
      [{}, []],
      [{ stripeCustomerId: CUSTOMER_ID }, []],
      [{ stripeCustomerId: CUSTOMER_ID }, [{ status: 'incomplete' }]],
      [
        { stripeCustomerId: CUSTOMER_ID },
        [{ status: 'active', offer: 'UNRELATED' }],
      ],
    ])('finds no subscription for %j %j', async (userData, subscriptions) => {
      const { service } = build(userData, subscriptions);

      await expect(service.retrieve(USER_UUID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cancel', () => {
    it('ends the subscription at the period end', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID }, [
        { status: 'active' },
      ]);

      const subscription = await service.cancel(USER_UUID);

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        'sub_premium_monthly',
        {
          cancel_at_period_end: true,
        },
      );
      expect(subscription.status).toBe('active');
    });

    it('leaves an already cancelled subscription untouched', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID }, [
        { status: 'active', cancel_at: PERIOD_END, cancel_at_period_end: true },
      ]);

      await expect(service.cancel(USER_UUID)).resolves.toMatchObject({
        cancelAt: new Date(PERIOD_END * 1000),
      });
      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });

    it('cancels a lifetime plan like any other', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID }, [
        { status: 'active', offer: Offer.FounderLifetime },
      ]);

      await service.cancel(USER_UUID);

      expect(client.subscriptions.update).toHaveBeenCalledWith(
        'sub_founder_lifetime',
        {
          cancel_at_period_end: true,
        },
      );
    });
  });

  describe('resume', () => {
    it.each<[boolean, Record<string, unknown>]>([
      [true, { cancel_at_period_end: false }],
      [false, { cancel_at: '' }],
    ])(
      'lifts a scheduled end (at the period end: %s)',
      async (atPeriodEnd, params) => {
        const { service, client } = build({ stripeCustomerId: CUSTOMER_ID }, [
          {
            status: 'active',
            cancel_at: PERIOD_END,
            cancel_at_period_end: atPeriodEnd,
          },
        ]);

        await service.resume(USER_UUID);

        expect(client.subscriptions.update).toHaveBeenCalledWith(
          'sub_premium_monthly',
          params,
        );
      },
    );

    it('leaves a renewing subscription untouched', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID }, [
        { status: 'active' },
      ]);

      await service.resume(USER_UUID);

      expect(client.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe('listInvoices', () => {
    const PAID = {
      id: 'in_1',
      number: 'TKN-0001',
      status: 'paid',
      total: 1499,
      currency: 'eur',
      created: CREATED,
      hosted_invoice_url: 'https://invoice.stripe.com/i/1',
      invoice_pdf: 'https://pay.stripe.com/invoice/1/pdf',
    };

    const mockInvoices = (
      client: ReturnType<typeof build>['client'],
      invoices: object[],
    ) =>
      client.invoices.list.mockReturnValue({
        autoPagingToArray: jest.fn().mockResolvedValue(invoices),
      });

    it('lists the finalized invoices of the customer', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID });
      mockInvoices(client, [PAID, { id: 'in_2', status: 'draft' }]);

      await expect(
        service.listInvoices(USER_UUID, { offset: 0, limit: 20 }),
      ).resolves.toEqual({
        items: [
          {
            id: 'in_1',
            number: 'TKN-0001',
            status: 'paid',
            amount: 1499,
            currency: 'eur',
            createdAt: new Date(CREATED * 1000),
            hostedUrl: 'https://invoice.stripe.com/i/1',
            pdfUrl: 'https://pay.stripe.com/invoice/1/pdf',
          },
        ],
        total: 1,
      });
      expect(client.invoices.list).toHaveBeenCalledWith({
        customer: CUSTOMER_ID,
        limit: 100,
      });
    });

    it('returns the requested page along with the total', async () => {
      const { service, client } = build({ stripeCustomerId: CUSTOMER_ID });
      mockInvoices(
        client,
        ['in_1', 'in_2', 'in_3'].map((id) => ({ ...PAID, id })),
      );

      const { items, total } = await service.listInvoices(USER_UUID, {
        offset: 1,
        limit: 1,
      });

      expect(items.map(({ id }) => id)).toEqual(['in_2']);
      expect(total).toBe(3);
    });

    it('lists nothing for a user without Stripe customer', async () => {
      const { service, client } = build();

      await expect(
        service.listInvoices(USER_UUID, { offset: 0, limit: 20 }),
      ).resolves.toEqual({ items: [], total: 0 });
      expect(client.invoices.list).not.toHaveBeenCalled();
    });
  });

  describe('completeRedirect', () => {
    it('syncs the plan then targets the frontend callback', async () => {
      const { service, user, flush } = build(
        { stripeCustomerId: CUSTOMER_ID },
        [{ status: 'active' }],
      );

      const url = await service.completeRedirect(
        USER_UUID,
        'success',
        '/settings/profile',
      );

      expect(user.plan).toBe(Plan.Premium);
      expect(flush).toHaveBeenCalled();
      expect(url).toBe(
        'http://localhost:8080/callback/stripe?status=success&redirectUrl=%2Fsettings%2Fprofile',
      );
    });

    it('ignores an unknown status', async () => {
      const { service } = build({ stripeCustomerId: CUSTOMER_ID });

      await expect(
        service.completeRedirect(USER_UUID, 'premium-please'),
      ).resolves.toBe('http://localhost:8080/callback/stripe');
    });
  });

  describe('syncPlan', () => {
    it.each<[FakeSubscription[], Plan]>([
      [[{ status: 'active' }], Plan.Premium],
      [[{ status: 'trialing' }], Plan.Premium],
      [[{ status: 'active', offer: Offer.FounderLifetime }], Plan.Founder],
      [
        [
          { status: 'active', offer: Offer.FounderLifetime },
          { status: 'active', offer: Offer.PremiumMonthly },
        ],
        Plan.Founder,
      ],
      [[{ status: 'past_due' }], Plan.Free],
      [[{ status: 'active', offer: 'UNRELATED' }], Plan.Free],
      [[], Plan.Free],
    ])('maps subscriptions %j to %s', async (subscriptions, plan) => {
      const { service, user } = build(
        { stripeCustomerId: CUSTOMER_ID, plan: Plan.Premium },
        subscriptions,
      );

      await service.syncPlan(user);

      expect(user.plan).toBe(plan);
    });

    it('leaves a user without Stripe customer untouched', async () => {
      const { service, user, client } = build({ plan: Plan.Premium });

      await service.syncPlan(user);

      expect(user.plan).toBe(Plan.Premium);
      expect(client.subscriptions.list).not.toHaveBeenCalled();
    });
  });

  describe('handleEvent', () => {
    const rawBody = Buffer.from('{}');

    it('rejects an invalid signature', async () => {
      const { service, client } = build();
      client.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('bad signature');
      });

      await expect(service.handleEvent(rawBody, 'sig')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('syncs the plan of the customer behind a subscription event', async () => {
      const { service, client, user, userRepository } = build(
        { stripeCustomerId: CUSTOMER_ID, plan: Plan.Premium },
        [],
      );
      client.webhooks.constructEvent.mockReturnValue({
        id: 'evt_1',
        type: 'customer.subscription.deleted',
        data: { object: { customer: CUSTOMER_ID } },
      });

      await service.handleEvent(rawBody, 'sig');

      expect(client.webhooks.constructEvent).toHaveBeenCalledWith(
        rawBody,
        'sig',
        'whsec_123',
      );
      expect(userRepository.findOne).toHaveBeenCalledWith({
        stripeCustomerId: CUSTOMER_ID,
      });
      expect(user.plan).toBe(Plan.Free);
    });

    it('ignores unrelated events and unknown customers', async () => {
      const { service, client, userRepository, flush } = build();
      client.webhooks.constructEvent.mockReturnValue({
        id: 'evt_2',
        type: 'invoice.paid',
        data: { object: {} },
      });

      await service.handleEvent(rawBody, 'sig');
      expect(userRepository.findOne).not.toHaveBeenCalled();

      client.webhooks.constructEvent.mockReturnValue({
        id: 'evt_3',
        type: 'customer.subscription.updated',
        data: { object: { customer: 'cus_unknown' } },
      });
      userRepository.findOne.mockResolvedValue(null);

      await service.handleEvent(rawBody, 'sig');
      expect(flush).not.toHaveBeenCalled();
    });
  });
});
