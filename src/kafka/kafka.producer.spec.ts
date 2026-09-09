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
    client: { producer: () => producer },
  } as unknown as KafkaService;
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

    await producer.publish(
      KafkaTopic.ORDER,
      'DH-001',
      KafkaEventName.ORDER_CREATED,
      {
        orderCode: 'DH-001',
      },
    );

    expect(send).toHaveBeenCalledTimes(1);
    const sent = (
      send.mock.calls as [
        { topic: string; messages: { key: string; value: string }[] },
      ][]
    )[0][0];
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

  it('never throws when the broker is down', async () => {
    // A dead broker must not fail the request that produced the event: Kafka is
    // a side channel here, not the source of truth.
    const producer = new KafkaProducer(
      fakeKafkaService({
        connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        send: jest.fn(),
      }),
    );
    jest.spyOn(producer['logger'], 'error').mockImplementation(() => undefined);

    await expect(
      producer.publish(
        KafkaTopic.ORDER,
        'DH-001',
        KafkaEventName.ORDER_CREATED,
        {},
      ),
    ).resolves.toBeUndefined();
  });

  it('connects once when several publishes race', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const producer = new KafkaProducer(
      fakeKafkaService({ connect, send: jest.fn().mockResolvedValue([]) }),
    );

    await Promise.all([
      producer.publish(KafkaTopic.ORDER, 'a', KafkaEventName.ORDER_CREATED, {}),
      producer.publish(KafkaTopic.ORDER, 'b', KafkaEventName.ORDER_CREATED, {}),
      producer.publish(KafkaTopic.ORDER, 'c', KafkaEventName.ORDER_CREATED, {}),
    ]);

    expect(connect).toHaveBeenCalledTimes(1);
  });
});
