export class ConfigManager {
  public static fromJSON(json: unknown): unknown {
    return new ConfigManager();
  }

  public toJSON(): unknown {
    return {};
  }
}
