import {
  AmountForm,
  ChipModel,
  Direction,
  EndResolution,
  PayoutMode,
  PotMode,
  TurnRegime,
  type GameConfig,
  type GameTemplate,
} from '@tokenizer/shared/types';

/**
 * The templates a plan without `canCustomize` picks from instead of building a
 * config from scratch, and what `defaultGameConfig()` falls back to when a
 * session is created with neither `config` nor `templateId`. Just one entry
 * today; adding another means only adding here — nothing else keys off the list
 * length.
 */
export const GAME_TEMPLATES: readonly GameTemplate[] = [
  {
    id: 'simple-poker',
    name: 'Simple Poker',
    description:
      'Small/big blind, check, call, raise and fold — the classic rules.',
    config: {
      seating: {
        seats: [
          { displayName: 'Seat 1' },
          { displayName: 'Seat 2' },
          { displayName: 'Seat 3' },
          { displayName: 'Seat 4' },
        ],
        defaultInitialBalance: 1000,
        allowMidGameClaims: true,
        // A poker night is exactly the case for it: four declared seats, and
        // a fifth person turning up once they are all taken.
        allowExtraSeats: true,
      },
      economy: {
        potMode: PotMode.Single,
        chipModel: ChipModel.AbstractBalance,
        payoutMode: PayoutMode.WinnerTakesAll,
        forcedBets: [
          { label: 'small_blind', amount: 5, seatOffset: 0 },
          { label: 'big_blind', amount: 10, seatOffset: 1 },
        ],
      },
      actionCatalog: [
        {
          id: 'check',
          label: 'Check',
          amountForm: AmountForm.None,
          grantsInterruption: false,
        },
        {
          id: 'call',
          label: 'Call',
          amountForm: AmountForm.Constrained,
          grantsInterruption: false,
        },
        {
          id: 'raise',
          label: 'Raise',
          amountForm: AmountForm.Raise,
          grantsInterruption: false,
        },
        {
          id: 'fold',
          label: 'Fold',
          amountForm: AmountForm.None,
          grantsInterruption: false,
          foldsParticipant: true,
        },
      ],
      turnPolicy: {
        regime: TurnRegime.Sequential,
        direction: Direction.Clockwise,
        interruptionWindow: null,
      },
      endPolicy: {
        resolution: EndResolution.Automatic,
        conditions: [{ type: 'LAST_PLAYER_STANDING', params: null }],
      },
    },
  },
];

/**
 * Looks up a template by id, or `undefined` for an unknown one. The config is
 * deep-cloned on every call: `GAME_TEMPLATES` is a shared module-level
 * constant, and callers go on to hand its config to the runtime, which treats
 * it as its own — mutating the template in place would corrupt it for every
 * game opened from it afterwards.
 */
export function getTemplateById(id: string): Optional<GameTemplate> {
  const template = GAME_TEMPLATES.find((entry) => entry.id === id);
  if (!template) return undefined;

  return { ...template, config: structuredClone(template.config) };
}

/**
 * Used when a session is created without an explicit config or templateId.
 * Currently just the first template's config — kept as its own function so
 * callers never have to know that, or reach into `GAME_TEMPLATES[0]`
 * themselves. Deep-cloned for the same reason as `getTemplateById`.
 */
export function defaultGameConfig(): GameConfig {
  return structuredClone(GAME_TEMPLATES[0].config);
}
