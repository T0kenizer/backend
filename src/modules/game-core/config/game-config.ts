import type { ActionDef } from './action-def';
import type { EconomyPolicy } from './economy-policy';
import type { EndPolicy } from './end-policy';
import type { TurnPolicy } from './turn-policy';

export interface GameConfig {
  economy: EconomyPolicy;
  actionCatalog: ActionDef[];
  turnPolicy: TurnPolicy;
  endPolicy: EndPolicy;
}
