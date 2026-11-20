import { Offer } from '@tokenizer/shared/types';
import type Stripe from 'stripe';

// What Checkout sells when the frontend names no offer, or an unknown one.
export const DEFAULT_OFFER = Offer.PremiumMonthly;

export const STRIPE_CALLBACK_PATH = '/callback/stripe';

export const STRIPE_REDIRECT_URL_PARAM = 'redirectUrl';

export const PAID_SUBSCRIPTION_STATUSES: readonly Stripe.Subscription.Status[] =
  ['active', 'trialing'];

export const UNSTARTED_SUBSCRIPTION_STATUSES: readonly Stripe.Subscription.Status[] =
  ['incomplete', 'incomplete_expired'];

// The most invoices fetched from Stripe before paginating them.
export const INVOICES_FETCH_LIMIT = 1000;

export const SUBSCRIPTION_EVENTS: readonly Stripe.Event.Type[] = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];
