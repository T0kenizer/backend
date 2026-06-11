export enum AmountForm {
  NONE = 'NONE',
  FREE = 'FREE',
  CONSTRAINED = 'CONSTRAINED',
  RAISE = 'RAISE',
}

export interface ActionDef {
  id: string;
  label: string;
  amountForm: AmountForm;
  /** When true, submitting this action opens an interruption window */
  grantsInterruption: boolean;
}
