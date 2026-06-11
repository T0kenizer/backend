import type { GameConfig } from './config/game-config';

// Thin wrapper for the ORM entity to serialize/deserialize GameConfig from JSONB.
export class ConfigManager {
  private readonly config: GameConfig;

  constructor(config: GameConfig) {
    this.config = config;
  }

  public static fromJSON(json: unknown): ConfigManager {
    return new ConfigManager(json as GameConfig);
  }

  public toJSON(): GameConfig {
    return this.config;
  }

  public getConfig(): GameConfig {
    return this.config;
  }
}
