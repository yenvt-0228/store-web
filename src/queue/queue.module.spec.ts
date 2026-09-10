import { ConfigService } from '@nestjs/config';
import { redisConnection } from './queue.module';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('redisConnection', () => {
  it('uses REDIS_URL and ignores the four separate variables', () => {
    // A managed provider (Render, Upstash) hands out a URL only. Reading
    // REDIS_HOST instead pointed every queue at 127.0.0.1, where nothing
    // answers — invisible in dev, fatal in production.
    expect(
      redisConnection(
        config({
          REDIS_URL: 'rediss://user:pass@managed-host:6380',
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: '6379',
        }),
      ),
    ).toEqual({ url: 'rediss://user:pass@managed-host:6380' });
  });

  it('falls back to host/port/password/db when no URL is set', () => {
    expect(
      redisConnection(
        config({
          REDIS_HOST: 'redis.internal',
          REDIS_PORT: '6380',
          REDIS_PASSWORD: 'secret',
          REDIS_DB: '2',
        }),
      ),
    ).toEqual({
      host: 'redis.internal',
      port: 6380,
      password: 'secret',
      db: 2,
    });
  });

  it('defaults to localhost when nothing is configured', () => {
    expect(redisConnection(config({}))).toEqual({
      host: '127.0.0.1',
      port: 6379,
      password: undefined,
      db: 0,
    });
  });

  it('treats an empty REDIS_URL as not set', () => {
    expect(redisConnection(config({ REDIS_URL: '', REDIS_HOST: 'h' }))).toEqual(
      {
        host: 'h',
        port: 6379,
        password: undefined,
        db: 0,
      },
    );
  });
});
