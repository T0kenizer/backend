import {
  cancelSubscriptionResponseSchema,
  listInvoicesQuerySchema,
  listInvoicesResponseSchema,
  resumeSubscriptionResponseSchema,
  retrievePaymentMethodResponseSchema,
  retrieveSubscriptionResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Retrieve Subscription DTOs */

export class RetrieveSubscriptionResponse extends createZodDto(
  retrieveSubscriptionResponseSchema,
) {}

/** Cancel Subscription DTOs */

export class CancelSubscriptionResponse extends createZodDto(
  cancelSubscriptionResponseSchema,
) {}

/** Resume Subscription DTOs */

export class ResumeSubscriptionResponse extends createZodDto(
  resumeSubscriptionResponseSchema,
) {}

/** List Invoices DTOs */

export class ListInvoicesQuery extends createZodDto(listInvoicesQuerySchema) {}
export class ListInvoicesResponse extends createZodDto(
  listInvoicesResponseSchema,
) {}

/** Retrieve Payment Method DTOs */

export class RetrievePaymentMethodResponse extends createZodDto(
  retrievePaymentMethodResponseSchema,
) {}
