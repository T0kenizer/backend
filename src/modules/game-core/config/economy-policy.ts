export enum PotMode {
  SINGLE = 'SINGLE',
  MULTIPLE_SIDEPOTS = 'MULTIPLE_SIDEPOTS',
}

export enum ChipModel {
  ABSTRACT_BALANCE = 'ABSTRACT_BALANCE',
  DENOMINATED = 'DENOMINATED',
}

export enum PayoutMode {
  WINNER_TAKES_ALL = 'WINNER_TAKES_ALL',
  SPLIT = 'SPLIT',
  PEER_TO_PEER = 'PEER_TO_PEER',
}

export interface ForcedBet {
  label: string;
  amount: number;
  /** Position relative to seat 0 (dealer anchor) */
  seatOffset: number;
}

export interface EconomyPolicy {
  potMode: PotMode;
  chipModel: ChipModel;
  forcedBets: ForcedBet[];
  payoutMode: PayoutMode;
}
