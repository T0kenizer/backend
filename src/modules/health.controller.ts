import { EntityManager } from '@mikro-orm/postgresql';
import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisCacheService } from './redis/services/redis-cache.service';
import { RedisQueueService } from './redis/services/redis-queue.service';
import { RedisService } from './redis/services/redis.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly em: EntityManager,
    private readonly redisService: RedisService,
    private readonly redisQueueService: RedisQueueService,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  @Get()
  live() {
    return;
  }

  @Get('ready')
  async ready() {
    const timeout = <T>(p: Promise<T>, ms = 1000) =>
      Promise.race([
        p,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), ms),
        ),
      ]);

    const checks: { name: string; probe: Promise<unknown> }[] = [
      { name: 'database', probe: this.em.getConnection().execute('SELECT 1') },
      { name: 'Redis (core)', probe: this.redisService.client.ping() },
      { name: 'Redis (queue)', probe: this.redisQueueService.client.ping() },
      { name: 'Redis (cache)', probe: this.redisCacheService.client.ping() },
    ];

    const results = await Promise.allSettled(
      checks.map(({ probe }) => timeout(probe)),
    );

    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ name: checks[index].name, reason: result.reason as unknown }]
        : [],
    );

    if (failures.length > 0) {
      for (const { name, reason } of failures) {
        this.logger.error(
          `Readiness check failed: ${name} is unavailable`,
          reason instanceof Error ? reason.stack : String(reason),
        );
      }

      throw new ServiceUnavailableException();
    }
  }
}
