import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EachMessagePayload } from 'kafkajs';
import type { RedisService } from '../redis/redis.service';
import { KafkaConsumer } from './kafka.consumer';
import {
  KAFKA_DLQ_TOPIC,
  KAFKA_HANDLER_ATTEMPTS,
  KAFKA_RESTART_DELAY_MS,
  KafkaEnvelope,
  KafkaEventName,
  KafkaTopic,
} from './kafka.constant';
import type { KafkaProducer } from './kafka.producer';
import { KafkaService } from './kafka.service';

// The consumer only needs `groupId` and a consumer factory from the service;
// building the real one would open a connection to a broker.
function fakeKafkaService(): KafkaService {
  return {
    groupId: 'test-group',
    ensureTopics: jest.fn().mockResolvedValue(undefined),
    createConsumer: () => ({}),
  } as unknown as KafkaService;
}

function fakeProducer() {
  return { sendRaw: jest.fn().mockResolvedValue(undefined) };
}

/** Remembers what was marked as handled, like the real Redis would. */
function fakeRedis(handled = new Set<string>()) {
  return {
    handled,
    service: {
      ensureConnected: jest.fn().mockResolvedValue(undefined),
      client: {
        exists: jest.fn((key: string) =>
          Promise.resolve(handled.has(key) ? 1 : 0),
        ),
        set: jest.fn((key: string) => {
          handled.add(key);
          return Promise.resolve('OK');
        }),
      },
    } as unknown as RedisService,
  };
}

function message(value: string | null, key?: string): EachMessagePayload {
  return {
    topic: KafkaTopic.ORDER,
    partition: 0,
    message: {
      offset: '7',
      key: key === undefined ? null : Buffer.from(key),
      value: value === null ? null : Buffer.from(value),
    },
  } as unknown as EachMessagePayload;
}

function envelope(
  overrides: Partial<KafkaEnvelope<{ orderCode: string }>> = {},
): KafkaEnvelope<{ orderCode: string }> {
  return {
    eventId: 'a9f0f0f0-0000-4000-8000-000000000000',
    eventName: KafkaEventName.ORDER_CREATED,
    occurredAt: '2026-09-09T00:00:00.000Z',
    payload: { orderCode: 'DH-001' },
    ...overrides,
  };
}

// `handleMessage` is private, but it is the whole behaviour worth testing:
// everything else is a kafkajs connection.
function handle(consumer: KafkaConsumer, payload: EachMessagePayload) {
  return (
    consumer as unknown as {
      handleMessage(payload: EachMessagePayload): Promise<void>;
    }
  ).handleMessage(payload);
}

describe('KafkaConsumer', () => {
  let events: EventEmitter2;
  let consumer: KafkaConsumer;
  let producer: ReturnType<typeof fakeProducer>;
  let redis: ReturnType<typeof fakeRedis>;

  beforeEach(() => {
    events = new EventEmitter2();
    producer = fakeProducer();
    redis = fakeRedis();
    consumer = new KafkaConsumer(
      fakeKafkaService(),
      events,
      producer as unknown as KafkaProducer,
      redis.service,
    );
    jest.spyOn(consumer['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(consumer['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('re-emits the payload under the kafka. prefix, not the local event name', async () => {
    const inbound = jest.fn();
    const local = jest.fn();
    events.on('kafka.order.created', inbound);
    events.on('order.created', local);

    await handle(consumer, message(JSON.stringify(envelope())));

    expect(inbound).toHaveBeenCalledWith({ orderCode: 'DH-001' });
    // Emitting the local name would run the mail listener a second time and
    // loop the event back onto the topic.
    expect(local).not.toHaveBeenCalled();
  });

  it('waits for async handlers before returning, so the offset moves after them', async () => {
    const order: string[] = [];
    // EventEmitter2 types a listener as returning void, but emitAsync does
    // await what it returns — which is exactly the behaviour under test here.
    const slowHandler = () =>
      new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
        order.push('handler');
      });
    events.on('kafka.order.created', slowHandler as () => void);

    await handle(consumer, message(JSON.stringify(envelope())));
    order.push('after');

    expect(order).toEqual(['handler', 'after']);
  });

  it('handles the same event only once, however often Kafka delivers it', async () => {
    // At-least-once delivery: a rebalance, an uncommitted offset or an outbox
    // row published twice all put the same event on the wire again.
    const inbound = jest.fn();
    events.on('kafka.order.created', inbound);

    await handle(consumer, message(JSON.stringify(envelope())));
    await handle(consumer, message(JSON.stringify(envelope())));

    expect(inbound).toHaveBeenCalledTimes(1);
  });

  it('handles two different events that arrive on the same offset shape', async () => {
    const inbound = jest.fn();
    events.on('kafka.order.created', inbound);

    await handle(consumer, message(JSON.stringify(envelope())));
    await handle(
      consumer,
      message(JSON.stringify(envelope({ eventId: 'another-id' }))),
    );

    expect(inbound).toHaveBeenCalledTimes(2);
  });

  it('handles the message when deduplication is unavailable', async () => {
    // Redis being down must not stop events from being processed: a duplicate
    // side effect is recoverable, a silently dropped event is not.
    const inbound = jest.fn();
    events.on('kafka.order.created', inbound);
    redis.service.ensureConnected = jest
      .fn()
      .mockRejectedValue(new Error('Redis is down'));

    await handle(consumer, message(JSON.stringify(envelope())));

    expect(inbound).toHaveBeenCalledTimes(1);
  });

  it('dead-letters a malformed message instead of throwing it back at kafkajs', async () => {
    // Throwing would make kafkajs replay the same broken message forever and
    // block every message behind it in the partition.
    await expect(
      handle(consumer, message('{ not json')),
    ).resolves.toBeUndefined();
    await expect(
      handle(consumer, message(JSON.stringify({ payload: {} }))),
    ).resolves.toBeUndefined();

    expect(producer.sendRaw).toHaveBeenCalledTimes(2);
    const [topic] = producer.sendRaw.mock.calls[0] as [string];
    expect(topic).toBe(KAFKA_DLQ_TOPIC);
  });

  it('skips an empty message without dead-lettering it', async () => {
    // A null value is a tombstone, a legitimate Kafka message — not a failure.
    await expect(handle(consumer, message(null))).resolves.toBeUndefined();
    expect(producer.sendRaw).not.toHaveBeenCalled();
  });

  it('logs what it handled, keyed by the aggregate id', async () => {
    const debug = jest
      .spyOn(consumer['logger'], 'debug')
      .mockImplementation(() => undefined);

    await handle(consumer, message(JSON.stringify(envelope()), 'DH-001'));

    // The key, not a payload field: this class must stay usable for a topic
    // whose payload shape it knows nothing about.
    expect(debug).toHaveBeenCalledWith(
      'store.order.events[0]@7: handled order.created (key DH-001).',
    );
  });

  it('retries a failing handler before giving up on it', async () => {
    const handler = jest.fn(() => {
      throw new Error('handler exploded');
    });
    events.on('kafka.order.created', handler);

    await handle(consumer, message(JSON.stringify(envelope())));

    expect(handler).toHaveBeenCalledTimes(KAFKA_HANDLER_ATTEMPTS);
  });

  it('dead-letters a message its handlers could not process, and moves on', async () => {
    events.on('kafka.order.created', () => {
      throw new Error('handler exploded');
    });
    const debug = jest
      .spyOn(consumer['logger'], 'debug')
      .mockImplementation(() => undefined);

    await expect(
      handle(consumer, message(JSON.stringify(envelope()), 'DH-001')),
    ).resolves.toBeUndefined();

    const [topic, key, value] = producer.sendRaw.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(topic).toBe(KAFKA_DLQ_TOPIC);
    expect(key).toBe('DH-001');
    expect(JSON.parse(value)).toMatchObject({
      origin: { topic: KafkaTopic.ORDER, partition: 0, offset: '7' },
      attempts: KAFKA_HANDLER_ATTEMPTS,
      error: 'handler exploded',
      // Verbatim, so the message can be replayed from the dead-letter topic.
      value: JSON.stringify(envelope()),
    });
    expect(debug).not.toHaveBeenCalled();
  });

  it('does not mark a dead-lettered event as handled', async () => {
    // Otherwise a replay from the dead-letter topic, once the bug is fixed,
    // would be dropped as a duplicate.
    events.on('kafka.order.created', () => {
      throw new Error('handler exploded');
    });

    await handle(consumer, message(JSON.stringify(envelope())));

    expect(redis.handled.size).toBe(0);
  });

  it('throws when the dead-letter write fails too, so the offset stays put', async () => {
    // This is the one case where blocking the partition is right: the message
    // is neither handled nor parked, and committing the offset would lose it.
    events.on('kafka.order.created', () => {
      throw new Error('handler exploded');
    });
    producer.sendRaw.mockRejectedValue(new Error('broker unreachable'));

    await expect(
      handle(consumer, message(JSON.stringify(envelope()))),
    ).rejects.toThrow('handler exploded');
  });
});

type CrashListener = (event: {
  payload: { error: Error; restart: boolean };
}) => void;

function fakeConsumer(overrides: Record<string, jest.Mock> = {}) {
  const listeners: Record<string, CrashListener> = {};

  return {
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event: string, listener: CrashListener) => {
      listeners[event] = listener;
    }),
    events: { CRASH: 'consumer.crash' },
    crash: (restart: boolean) =>
      listeners['consumer.crash']?.({
        payload: { error: new Error('boom'), restart },
      }),
    ...overrides,
  };
}

describe('KafkaConsumer lifecycle', () => {
  function build(consumers: ReturnType<typeof fakeConsumer>[]) {
    const factory = jest.fn(() => consumers.shift() ?? fakeConsumer());
    const kafka = {
      groupId: 'test-group',
      ensureTopics: jest.fn().mockResolvedValue(undefined),
      createConsumer: factory,
    } as unknown as KafkaService;

    const consumer = new KafkaConsumer(
      kafka,
      new EventEmitter2(),
      fakeProducer() as unknown as KafkaProducer,
      fakeRedis().service,
    );
    jest.spyOn(consumer['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(consumer['logger'], 'log').mockImplementation(() => undefined);

    return { consumer, factory };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('never subscribes to the dead-letter topic', async () => {
    // Reading it back would hand the failures straight to the handler that
    // already gave up on them.
    const running = fakeConsumer();
    const { consumer } = build([running]);

    await consumer.onModuleInit();

    const [{ topics }] = running.subscribe.mock.calls[0] as [
      { topics: string[] },
    ];
    expect(topics).not.toContain(KAFKA_DLQ_TOPIC);
  });

  it('disconnects when the start fails after connecting', async () => {
    // Leaving the connection open keeps a dead member in the group until the
    // session times out, and holds the process open on shutdown.
    const broken = fakeConsumer({
      subscribe: jest.fn().mockRejectedValue(new Error('no such topic')),
    });
    const { consumer } = build([broken]);

    await consumer.onModuleInit();

    expect(broken.connect).toHaveBeenCalled();
    expect(broken.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not disconnect what never connected', async () => {
    const broken = fakeConsumer({
      connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const { consumer } = build([broken]);

    await consumer.onModuleInit();

    expect(broken.disconnect).not.toHaveBeenCalled();
  });

  it('restarts with a fresh consumer after a crash kafkajs will not retry', async () => {
    jest.useFakeTimers();
    const crashed = fakeConsumer();
    const replacement = fakeConsumer();
    const { consumer, factory } = build([crashed, replacement]);

    await consumer.onModuleInit();
    expect(factory).toHaveBeenCalledTimes(1);

    crashed.crash(false);
    // Async advance: the restart is scheduled from a promise chain, so the
    // microtasks have to run before the timer exists.
    await jest.advanceTimersByTimeAsync(KAFKA_RESTART_DELAY_MS);

    expect(crashed.disconnect).toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('leaves a crash kafkajs restarts itself alone', async () => {
    jest.useFakeTimers();
    const crashed = fakeConsumer();
    const { consumer, factory } = build([crashed]);

    await consumer.onModuleInit();
    crashed.crash(true);
    await jest.advanceTimersByTimeAsync(KAFKA_RESTART_DELAY_MS);

    // kafkajs is already restarting the loop; reconnecting on top of that would
    // put two consumers in the group.
    expect(crashed.disconnect).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('disconnects on shutdown and cancels a pending retry', async () => {
    jest.useFakeTimers();
    const running = fakeConsumer();
    const { consumer, factory } = build([running]);

    await consumer.onModuleInit();
    await consumer.onApplicationShutdown();

    expect(running.disconnect).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(KAFKA_RESTART_DELAY_MS);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
