import {
  Feature,
  GameMode,
  Plan,
  type PlansMetadata,
} from '@tokenizer/shared/types';

export const PLAN_METADATA: PlansMetadata = {
  [Plan.Anonymous]: {
    [Feature.JoinGame]: { access: true },
    [Feature.CreateGame]: {
      access: false,
      modes: [],
      maxSeats: 0,
    },
  },
  [Plan.Free]: {
    [Feature.JoinGame]: { access: true },
    [Feature.CreateGame]: {
      access: true,
      modes: [GameMode.Poker],
      maxSeats: 4,
    },
  },
  [Plan.Premium]: {
    [Feature.JoinGame]: { access: true },
    [Feature.CreateGame]: {
      access: true,
      modes: [GameMode.Poker, GameMode.Free],
      maxSeats: 12,
    },
  },
  [Plan.Founder]: {
    [Feature.JoinGame]: { access: true },
    [Feature.CreateGame]: {
      access: true,
      modes: [GameMode.Poker, GameMode.Free],
      maxSeats: 12,
    },
  },
};
