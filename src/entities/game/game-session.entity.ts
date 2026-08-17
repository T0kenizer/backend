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
    name: 'closed_at',
    type: 'timestamptz',
    nullable: true,
  })
  closedAt: Nullable<Date> = null;

  @Property({
    persist: false,
  })
  get config(): ConfigManager {
    return ConfigManager.fromJSON(this._config);
  }

  // The hydrator also routes the raw `config` column through this setter, so
  // it must accept plain JSON as well as a ConfigManager.
  set config(value: ConfigManager | ConfigJSON) {
    this._config = value instanceof ConfigManager ? value.toJSON() : value;
  }
}
