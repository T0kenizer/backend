import { EntityManager } from '@mikro-orm/postgresql';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async check() {
    try {
      await this.redisService.client.ping();
      await this.em.getConnection().execute('SELECT 1');
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
