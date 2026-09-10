import { KafkaEventName, KafkaTopic } from '../kafka/kafka.constant';
import type { Prisma } from '../generated/prisma/client';
import { OutboxService } from './outbox.service';

function fakeTx() {
  const create = jest.fn().mockResolvedValue({});
  return {
    create,
    tx: { outboxEvent: { create } } as unknown as Prisma.TransactionClient,
  };
}

const event = {
  topic: KafkaTopic.ORDER,
  key: 'DH-001',
  eventName: KafkaEventName.ORDER_CREATED,
  payload: { orderCode: 'DH-001' },
};

describe('OutboxService', () => {
  const original = process.env.KAFKA_ENABLED;

  afterEach(() => {
    process.env.KAFKA_ENABLED = original;
  });

  it('writes the event through the transaction it was given', async () => {
    // Not through the plain Prisma client: the row has to commit with the order
    // or not at all, which is the whole point of the outbox.
    process.env.KAFKA_ENABLED = 'true';
    const { create, tx } = fakeTx();

    await new OutboxService().record(tx, event);

    expect(create).toHaveBeenCalledWith({
      data: {
        topic: KafkaTopic.ORDER,
        eventKey: 'DH-001',
        eventName: KafkaEventName.ORDER_CREATED,
        payload: { orderCode: 'DH-001' },
      },
    });
  });

  it('writes nothing when Kafka is switched off', async () => {
    // No relay is running then, so the rows would only pile up unread.
    process.env.KAFKA_ENABLED = 'false';
    const { create, tx } = fakeTx();

    await new OutboxService().record(tx, event);

    expect(create).not.toHaveBeenCalled();
  });
});
