import * as Types from '@modules/redis/redis.types';
import { RedisService } from '@modules/redis/services/redis.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class RedisCacheService extends RedisService {
  public override get connectionOptions(): Types.RedisConnectionOptions {
    return {
      host: this.configService.get('REDIS_CACHE_HOST'),
      port: this.configService.get('REDIS_CACHE_PORT'),
    };
  }
}
