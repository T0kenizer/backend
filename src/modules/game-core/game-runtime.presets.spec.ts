import {
  GAME_TEMPLATES,
  defaultGameConfig,
  getTemplateById,
} from '@modules/game-core/game-runtime.presets';

describe('game-runtime.presets', () => {
  it('resolves a known template by id', () => {
    const template = getTemplateById('simple-poker');

    expect(template?.name).toBe('Simple Poker');
    expect(template?.config.seating.seats).toHaveLength(4);
  });

  it('returns undefined for an unknown template id', () => {
    expect(getTemplateById('not-a-template')).toBeUndefined();
  });

  it('never hands out the same config object twice, so a caller mutating it cannot corrupt the shared template', () => {
    const first = getTemplateById('simple-poker');
    const second = getTemplateById('simple-poker');

    expect(first?.config).not.toBe(second?.config);
    expect(first?.config).toEqual(second?.config);

    first!.config.seating.allowMidGameClaims = false;
    expect(GAME_TEMPLATES[0].config.seating.allowMidGameClaims).toBe(true);
  });

  it('defaults to the first template, freshly cloned on every call', () => {
    const first = defaultGameConfig();
    const second = defaultGameConfig();

    expect(first).toEqual(GAME_TEMPLATES[0].config);
    expect(first).not.toBe(second);
  });
});
