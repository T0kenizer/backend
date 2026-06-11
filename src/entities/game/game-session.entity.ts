import { User } from '@entities/user.entity';
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { ConfigManager } from '@modules/game-core/config-manager';

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
  private _config: unknown;

  @ManyToOne(() => User, {
    name: 'owner_uuid',
    nullable: false,
  })
  owner!: User;

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
