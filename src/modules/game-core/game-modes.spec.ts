import {
  GAME_MODES,
  defaultConfigFor,
  getMode,
} from '@modules/game-core/game-modes';
import { gameConfigSchema } from '@tokenizer/shared/schemas';
import { GameMode } from '@tokenizer/shared/types';

describe('game modes', () => {
  it('describes every mode with a config its own schema accepts', () => {
    for (const descriptor of GAME_MODES) {
      const parsed = gameConfigSchema.safeParse(descriptor.defaults);
      expect(parsed.success).toBe(true);
      // The discriminator has to agree with the descriptor, or a table opens
      // in one mode and is played in another.
      expect(descriptor.defaults.mode).toBe(descriptor.mode);
    }
  });

  it('opens a poker table on playable stakes', () => {
    const config = defaultConfigFor(GameMode.Poker);

    expect(config.rules.blinds.big).toBeGreaterThanOrEqual(
      config.rules.blinds.small,
    );
    // A stack has to be worth more than the blind it posts, or the first hand
    // is the last one.
    expect(config.seating.defaultInitialBalance).toBeGreaterThan(
      config.rules.blinds.big,
    );
    expect(config.seating.seats.length).toBeGreaterThanOrEqual(2);
  });

  it('hands out a copy, so a table can never edit the mode itself', () => {
    const first = defaultConfigFor(GameMode.Poker);
    first.rules.blinds.big = 999;

    expect(defaultConfigFor(GameMode.Poker).rules.blinds.big).not.toBe(999);
  });

  it('answers nothing for a mode it does not run', () => {
    expect(getMode('BACCARAT')).toBeUndefined();
  });
});
