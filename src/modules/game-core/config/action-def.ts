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
  /**
   * When true, submitting this action removes the participant from the round
   * (e.g. "fold"). They are skipped by turn rotation and excluded from the pool
   * evaluated by automatic end conditions.
   */
  foldsParticipant?: boolean;
}
