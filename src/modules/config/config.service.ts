import { Config } from '@modules/config/config.types';
import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService extends NestConfigService<Config> {
  get<K extends keyof Config>(key: K): Config[K] {
    return super.get(key, { infer: true }) as Config[K];
  }

  getOrThrow<K extends keyof Config>(key: K): NonNullable<Config[K]> {
    return super.getOrThrow(key, { infer: true });
  }
}
