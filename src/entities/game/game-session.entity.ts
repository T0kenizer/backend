import { GameParticipant } from '@entities/game/game-participant.entity';
import { User } from '@entities/user.entity';
import {
  Collection,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { ConfigManager } from '@modules/game-core/config-manager';
import type { ConfigJSON } from '@modules/game-core/game-core.types';

@Entity({
  tableName: 'game_sessions',
})
export class GameSession {
  @PrimaryKey({
    name: 'uuid',
    type: 'uuid',
    defaultRaw: 'gen_random_uuid()',
  })
  readonly uuid: string = crypto.randomUUID();

  @Property({
    name: 'config',
    type: 'jsonb',
    nullable: false,
  })
  private _config!: ConfigJSON;

  @ManyToOne(() => User, {
    name: 'owner_uuid',
    nullable: false,
  })
  owner!: User;

  @OneToMany(() => GameParticipant, (participant) => participant.session)
  participants = new Collection<GameParticipant>(this);

  @Property({
    persist: false,
  })
  get config(): ConfigManager {
    return ConfigManager.fromJSON(this._config);
  }

  set config(configManager: ConfigManager) {
    this._config = configManager.toJSON();
  }
}
