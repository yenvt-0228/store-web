import { KafkaEventName, KafkaTopic } from './kafka.constant';
import { KafkaProducer } from './kafka.producer';
import { KafkaService } from './kafka.service';

function fakeKafkaService(producer: {
  connect: jest.Mock;
  send: jest.Mock;
  disconnect?: jest.Mock;
}) {
  return {
    ensureTopics: jest.fn().mockResolvedValue(undefined),
    createProducer: () => producer,
  } as unknown as KafkaService;
}

function sentMessage(send: jest.Mock) {
  return (
    send.mock.calls as [
      { topic: string; messages: { key: string; value: string }[] },
    ][]
  )[0][0];
}

describe('KafkaProducer', () => {
  it('wraps the payload in an envelope and keys the message', async () => {
    const send = jest.fn().mockResolvedValue([]);
    const producer = new KafkaProducer(
      fakeKafkaService({
        connect: jest.fn().mockResolvedValue(undefined),
        send,
      }),
    );

    await producer.publish({
      topic: KafkaTopic.ORDER,
      key: 'DH-001',
      eventName: KafkaEventName.ORDER_CREATED,
      payload: { orderCode: 'DH-001' },
    });

    expect(send).toHaveBeenCalledTimes(1);
    const sent = sentMessage(send);
    expect(sent.topic).toBe(KafkaTopic.ORDER);
    // Same key for every message about one order keeps them in one partition,
    // so `confirmed` can never overtake `created`.
    expect(sent.messages[0].key).toBe('DH-001');
    expect(JSON.parse(sent.messages[0].value)).toEqual({
      eventId: expect.any(String) as string,
      eventName: KafkaEventName.ORDER_CREATED,
      occurredAt: expect.any(String) as string,
      payload: { orderCode: 'DH-001' },
    });
  });

  it('publishes under the caller’s event id, so a replay is recognisable', async () => {
    // The outbox passes its row id. A row whose send succeeded but was never
    // marked sent is published again with the same id, and the consumer drops
    // the duplicate instead of running every handler twice.
    const send = jest.fn().mockResolvedValue([]);
    const producer = new KafkaProducer(
      fakeKafkaService({
        connect: jest.fn().mockResolvedValue(undefined),
        send,
      }),
    );

    await producer.publish({
      topic: KafkaTopic.ORDER,
      key: 'DH-001',
      eventName: KafkaEventName.ORDER_CREATED,
      payload: {},
      eventId: 'outbox-row-1',
      occurredAt: '2026-09-10T00:00:00.000Z',
    });

    expect(JSON.parse(sentMessage(send).messages[0].value)).toMatchObject({
      eventId: 'outbox-row-1',
      occurredAt: '2026-09-10T00:00:00.000Z',
    });
  });

  it('throws when the broker is down, instead of reporting a lost event as sent', async () => {
    // The outbox relay is the only caller: swallowing the failure here would
    // make it mark the row SENT and lose the event for good.
    const producer = new KafkaProducer(
      fakeKafkaService({
        connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        send: jest.fn(),
      }),
    );

    await expect(
      producer.publish({
        topic: KafkaTopic.ORDER,
        key: 'DH-001',
        eventName: KafkaEventName.ORDER_CREATED,
        payload: {},
      }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('connects once when several publishes race', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const producer = new KafkaProducer(
      fakeKafkaService({ connect, send: jest.fn().mockResolvedValue([]) }),
    );

    const publish = (key: string) =>
      producer.publish({
        topic: KafkaTopic.ORDER,
        key,
        eventName: KafkaEventName.ORDER_CREATED,
        payload: {},
      });

    await Promise.all([publish('a'), publish('b'), publish('c')]);

    expect(connect).toHaveBeenCalledTimes(1);
  });
});
