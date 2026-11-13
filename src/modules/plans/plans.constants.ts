import {
  Feature,
  GameMode,
  Plan,
  type PlansMetadata,
} from '@tokenizer/shared/types';

export const PLAN_TIERS: Record<Plan, number> = {
  [Plan.Anonymous]: 0,
  [Plan.Free]: 1,
  [Plan.Premium]: 2,
  [Plan.Founder]: 3,
};

export const PLAN_METADATA: PlansMetadata = {
  [Plan.Anonymous]: {
    [Feature.JoinGame]: { access: true },
    [Feature.CreateGame]: {
      access: false,
      modes: [],
      maxSeats: 0,
      maxActiveGames: 0,
    },
  },
  [Plan.Free]: {
    [Feature.JoinGame]: { access: true },
    [Feature.CreateGame]: {
      access: true,
      modes: [GameMode.Poker],
      maxSeats: 4,
      maxActiveGames: 3,
    },
  },
  [Plan.Premium]: {
    [Feature.JoinGame]: { access: true },
    [Feature.CreateGame]: {
      access: true,
      modes: [GameMode.Poker, GameMode.Free],
      maxSeats: 12,
      maxActiveGames: Infinity,
    },
  },
  [Plan.Founder]: {
    [Feature.JoinGame]: { access: true },
    [Feature.CreateGame]: {
      access: true,
      modes: [GameMode.Poker, GameMode.Free],
      maxSeats: 12,
      maxActiveGames: Infinity,
    },
  },
};
