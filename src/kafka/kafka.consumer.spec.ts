import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EachMessagePayload } from 'kafkajs';
import { KafkaConsumer } from './kafka.consumer';
import { KafkaEnvelope, KafkaEventName, KafkaTopic } from './kafka.constant';
import { KafkaService } from './kafka.service';

// The consumer only needs `groupId` and a `consumer()` factory from the service;
// building the real one would open a connection to a broker.
function fakeKafkaService(): KafkaService {
  return {
    groupId: 'test-group',
    ensureTopics: jest.fn().mockResolvedValue(undefined),
    client: { consumer: () => ({}) },
  } as unknown as KafkaService;
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

function envelope(): KafkaEnvelope<{ orderCode: string }> {
  return {
    eventId: 'a9f0f0f0-0000-4000-8000-000000000000',
    eventName: KafkaEventName.ORDER_CREATED,
    occurredAt: '2026-09-09T00:00:00.000Z',
    payload: { orderCode: 'DH-001' },
  };
}

// `handle` is private, but it is the whole behaviour worth testing: everything
// else is a kafkajs connection.
function handle(consumer: KafkaConsumer, payload: EachMessagePayload) {
  return (
    consumer as unknown as {
      handle(payload: EachMessagePayload): Promise<void>;
    }
  ).handle(payload);
}

describe('KafkaConsumer', () => {
  let events: EventEmitter2;
  let consumer: KafkaConsumer;

  beforeEach(() => {
    events = new EventEmitter2();
    consumer = new KafkaConsumer(fakeKafkaService(), events);
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
    // Emitting the local name would run the publisher again and loop the event
    // back onto the topic.
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

  it('skips a malformed message instead of throwing it back at kafkajs', async () => {
    // Throwing would make kafkajs replay the same broken message forever and
    // block every message behind it in the partition.
    await expect(
      handle(consumer, message('{ not json')),
    ).resolves.toBeUndefined();
    await expect(handle(consumer, message(null))).resolves.toBeUndefined();
    await expect(
      handle(consumer, message(JSON.stringify({ payload: {} }))),
    ).resolves.toBeUndefined();
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

  it('does not log a handled message when the handler failed', async () => {
    const debug = jest
      .spyOn(consumer['logger'], 'debug')
      .mockImplementation(() => undefined);
    events.on('kafka.order.created', () => {
      throw new Error('handler exploded');
    });

    await handle(consumer, message(JSON.stringify(envelope()), 'DH-001'));

    expect(debug).not.toHaveBeenCalled();
  });

  it('swallows a failing handler', async () => {
    events.on('kafka.order.created', () => {
      throw new Error('handler exploded');
    });

    await expect(
      handle(consumer, message(JSON.stringify(envelope()))),
    ).resolves.toBeUndefined();
  });
});

// Mirrors RESTART_DELAY_MS in kafka.consumer.ts.
const RESTART_DELAY_MS = 10_000;

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
      client: { consumer: factory },
    } as unknown as KafkaService;

    const consumer = new KafkaConsumer(kafka, new EventEmitter2());
    jest.spyOn(consumer['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(consumer['logger'], 'log').mockImplementation(() => undefined);

    return { consumer, factory };
  }

  afterEach(() => {
    jest.useRealTimers();
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
    await jest.advanceTimersByTimeAsync(RESTART_DELAY_MS);

    expect(crashed.disconnect).toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('leaves a crash kafkajs restarts itself alone', async () => {
    jest.useFakeTimers();
    const crashed = fakeConsumer();
    const { consumer, factory } = build([crashed]);

    await consumer.onModuleInit();
    crashed.crash(true);
    await jest.advanceTimersByTimeAsync(RESTART_DELAY_MS);

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

    await jest.advanceTimersByTimeAsync(RESTART_DELAY_MS);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
