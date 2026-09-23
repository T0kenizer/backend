import { ConfigService } from '@modules/config/config.service';
import { RedisCacheService } from '@modules/redis/services/redis-cache.service';
import { RedisQueueService } from '@modules/redis/services/redis-queue.service';
import { RedisService } from '@modules/redis/services/redis.service';
import { Logger } from '@nestjs/common';
import { createNodeRedisClient } from 'bullmq';
import { createClient } from 'redis';

jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('bullmq', () => ({ createNodeRedisClient: jest.fn() }));

const CONFIG: Record<string, string | number> = {
  REDIS_HOST: 'redis',
  REDIS_PORT: 6379,
  REDIS_QUEUE_HOST: 'redis-queue',
  REDIS_QUEUE_PORT: 6380,
  REDIS_CACHE_HOST: 'redis-cache',
  REDIS_CACHE_PORT: 6381,
};

describe('Redis services', () => {
  let client: {
    on: jest.Mock;
    connect: jest.Mock;
    quit: jest.Mock;
    isOpen: boolean;
  };
  const configService = {
    get: (key: string) => CONFIG[key],
  } as unknown as ConfigService;

  /** Returns the handler registered for a client event. */
  const handlerFor = (event: string) =>
    (client.on.mock.calls as [string, (...args: unknown[]) => void][]).find(
      ([name]) => name === event,
    )![1];

  beforeEach(() => {
    client = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      isOpen: false,
    };
    (createClient as jest.Mock).mockReturnValue(client);
    (createNodeRedisClient as jest.Mock).mockImplementation(() => ({}));
  });

  describe(RedisService.name, () => {
    let service: RedisService;

    beforeEach(() => {
      service = new RedisService(configService);
    });

    it('should create the client eagerly, before onModuleInit', () => {
      // BullModule.forRootAsync resolves this service while the module is
      // still being instantiated, and would otherwise receive `undefined`.
      expect(createClient).toHaveBeenCalledWith({ url: 'redis://redis:6379' });
      expect(service.client).toBe(client);
    });

    it('should expose the connection options of the core instance', () => {
      expect(service.connectionOptions).toEqual({
        host: 'redis',
        port: 6379,
      });
    });

    describe('logging', () => {
      beforeEach(async () => {
        await service.onModuleInit();
      });

      it('should log when the client connects', () => {
        handlerFor('connect')();

        expect(Logger.prototype.log).toHaveBeenCalledWith('Connected to Redis');
      });

      it('should log the client errors', () => {
        const error = new Error('connection refused');

        handlerFor('error')(error);

        expect(Logger.prototype.error).toHaveBeenCalledWith(error);
      });
    });

    describe('bullConnection', () => {
      it('should wrap the client in the node-redis adapter', () => {
        // Handing BullMQ the raw node-redis client makes it fall back to the
        // ioredis adapter and require a package we do not install.
        expect(service.bullConnection).toBeDefined();
        expect(createNodeRedisClient).toHaveBeenCalledWith(client);
      });

      it('should memoise the adapter across calls', () => {
        expect(service.bullConnection).toBe(service.bullConnection);
        expect(createNodeRedisClient).toHaveBeenCalledTimes(1);
      });
    });

    describe('onModuleInit', () => {
      it('should connect the client', async () => {
        await service.onModuleInit();

        expect(client.connect).toHaveBeenCalled();
      });

      it('should not connect a client that is already open', async () => {
        client.isOpen = true;

        await service.onModuleInit();

        expect(client.connect).not.toHaveBeenCalled();
      });

      it('should swallow the race with the BullMQ adapter opening the socket', async () => {
        // `isOpen` only flips once the adapter's in-flight connect settles, so
        // whichever caller loses the race must be a no-op, not a crash.
        client.connect.mockRejectedValue(new Error('Socket already opened'));

        await expect(service.onModuleInit()).resolves.toBeUndefined();
      });

      it('should rethrow any other connection failure', async () => {
        client.connect.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(service.onModuleInit()).rejects.toThrow('ECONNREFUSED');
      });
    });

    describe('onModuleDestroy', () => {
      it('should quit an open client', async () => {
        client.isOpen = true;

        await service.onModuleDestroy();

        expect(client.quit).toHaveBeenCalled();
      });

      it('should leave a closed client alone', async () => {
        await service.onModuleDestroy();

        expect(client.quit).not.toHaveBeenCalled();
      });
    });
  });

  describe('dedicated instances', () => {
    it.each([
      [RedisQueueService, 'redis-queue', 6380],
      [RedisCacheService, 'redis-cache', 6381],
    ])('%p should target its own instance', (Service, host, port) => {
      const service = new Service(configService);

      expect(service.connectionOptions).toEqual({ host, port });
      expect(createClient).toHaveBeenCalledWith({
        url: `redis://${host}:${port}`,
      });
    });

    it('should log under the subclass name, not the base one', () => {
      // `new Logger(this.constructor.name)` — using `RedisService.name` would
      // make all three instances log as the base class.
      const logger = new RedisQueueService(configService)['logger'];

      expect(logger).toEqual(
        expect.objectContaining({ context: RedisQueueService.name }),
      );
    });
  });
});
