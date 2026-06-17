import type { ActionDef } from '@modules/game-core/config/action-def';
import type { EconomyPolicy } from '@modules/game-core/config/economy-policy';
import type { EndPolicy } from '@modules/game-core/config/end-policy';
import type { TurnPolicy } from '@modules/game-core/config/turn-policy';

export interface GameConfig {
  economy: EconomyPolicy;
  actionCatalog: ActionDef[];
  turnPolicy: TurnPolicy;
  endPolicy: EndPolicy;
}
