import { RedisCacheService } from '@modules/redis/services/redis-cache.service';
import { RedisQueueService } from '@modules/redis/services/redis-queue.service';
import { RedisService } from '@modules/redis/services/redis.service';
import { Module } from '@nestjs/common';

@Module({
  providers: [RedisCacheService, RedisQueueService, RedisService],
  exports: [RedisCacheService, RedisQueueService, RedisService],
})
export class RedisModule {}
