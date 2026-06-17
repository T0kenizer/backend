import { ConfigJSON } from '@modules/game-core/game-core.types';

export class ConfigManager {
  public static fromJSON(json: ConfigJSON): ConfigManager {
    return new ConfigManager();
  }

  public toJSON(): ConfigJSON {
    return {};
  }
}
