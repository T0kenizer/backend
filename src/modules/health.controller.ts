import { EntityManager } from '@mikro-orm/postgresql';
import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly em: EntityManager,
    private readonly redisService: RedisService,
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

    const [db, redis] = await Promise.allSettled([
      timeout(this.em.getConnection().execute('SELECT 1')),
      timeout(this.redisService.client.ping()),
    ]);

    if (db.status === 'rejected') {
      const reason: unknown = db.reason;
      this.logger.error(
        'Readiness check failed: database is unavailable',
        reason instanceof Error ? reason.stack : String(reason),
      );
      throw new ServiceUnavailableException();
    }

    if (redis.status === 'rejected') {
      const reason: unknown = redis.reason;
      this.logger.error(
        'Readiness check failed: Redis is unavailable',
        reason instanceof Error ? reason.stack : String(reason),
      );
      throw new ServiceUnavailableException();
    }
  }
}
