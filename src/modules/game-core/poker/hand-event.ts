import type { HandEventType, Street } from '@tokenizer/shared/types';

export interface HandEventParams {
  /** Null for something the table did rather than a player. */
  participantId: Nullable<string>;
  type: HandEventType;
  street: Street;
  amount?: number;
}

/** One immutable line of a hand's history. */
export class HandEvent {
  readonly id: string;
  readonly participantId: Nullable<string>;
  readonly type: HandEventType;
  readonly street: Street;
  readonly amount?: number;
  readonly timestamp: Date;

  constructor(params: HandEventParams) {
    this.id = crypto.randomUUID();
    this.participantId = params.participantId;
    this.type = params.type;
    this.street = params.street;
    this.amount = params.amount;
    this.timestamp = new Date();
    Object.freeze(this);
  }
}
