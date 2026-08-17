import { ConfigJSON } from '@modules/game-core/game-core.types';
import type { GameConfig } from '@tokenizer/shared/types';

/**
 * (De)serialization boundary between the `game_sessions.config` JSONB column
 * and the runtime `GameConfig`. The JSON is trusted as-is for now; schema
 * validation can be layered here once the config shape stabilises.
 */
export class ConfigManager {
  private constructor(private readonly _config: GameConfig) {}

  public static fromJSON(json: ConfigJSON): ConfigManager {
    return new ConfigManager(json as GameConfig);
  }

  public static fromConfig(config: GameConfig): ConfigManager {
    return new ConfigManager(config);
  }

  public get config(): GameConfig {
    return this._config;
  }

  public toJSON(): ConfigJSON {
    return this._config;
  }
}
