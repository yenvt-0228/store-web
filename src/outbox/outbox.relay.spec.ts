import { OutboxStatus } from '../generated/prisma/enums';
import type { KafkaProducer } from '../kafka/kafka.producer';
import { KafkaEventName, KafkaTopic } from '../kafka/kafka.constant';
import type { PrismaService } from '../prisma/prisma.service';
import { OUTBOX_MAX_ATTEMPTS } from './outbox.constant';
import { OutboxRelay } from './outbox.relay';

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    topic: KafkaTopic.ORDER,
    eventKey: 'DH-001',
    eventName: KafkaEventName.ORDER_CREATED,
    payload: { orderCode: 'DH-001' },
    status: OutboxStatus.PENDING,
    attempts: 0,
    lastError: null,
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    publishedAt: null,
    ...overrides,
  };
}

function build(rows: ReturnType<typeof row>[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const update = jest.fn().mockResolvedValue({});
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const publish = jest.fn().mockResolvedValue(undefined);

  const relay = new OutboxRelay(
    {
      outboxEvent: { findMany, update, deleteMany },
    } as unknown as PrismaService,
    { publish } as unknown as KafkaProducer,
  );
  jest.spyOn(relay['logger'], 'log').mockImplementation(() => undefined);
  jest.spyOn(relay['logger'], 'warn').mockImplementation(() => undefined);
  jest.spyOn(relay['logger'], 'error').mockImplementation(() => undefined);

  return { relay, findMany, update, deleteMany, publish };
}

describe('OutboxRelay', () => {
  it('publishes a pending row under its own id and marks it sent', async () => {
    const { relay, publish, update } = build([row()]);

    await relay.flush();

    expect(publish).toHaveBeenCalledWith({
      topic: KafkaTopic.ORDER,
      key: 'DH-001',
      eventName: KafkaEventName.ORDER_CREATED,
      payload: { orderCode: 'DH-001' },
      // The row id doubles as the event id, so a row published twice is
      // recognised as a duplicate by the consumer instead of handled twice.
      eventId: 'row-1',
      occurredAt: '2026-09-10T00:00:00.000Z',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: expect.objectContaining({
        status: OutboxStatus.SENT,
        attempts: 1,
        lastError: null,
      }) as unknown,
    });
  });

  it('reads oldest first', async () => {
    // `order.confirmed` must not reach the topic before `order.created`.
    const { relay, findMany } = build([]);

    await relay.flush();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: OutboxStatus.PENDING },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('stops the batch at the first failure instead of publishing past it', async () => {
    // The broker being down is the usual reason, and skipping ahead would put
    // one order's events on the topic in the wrong order.
    const { relay, publish } = build([
      row({ id: 'row-1' }),
      row({ id: 'row-2' }),
      row({ id: 'row-3' }),
    ]);
    publish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await relay.flush();

    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('leaves a failed row pending, so the next tick retries it', async () => {
    const { relay, publish, update } = build([row()]);
    publish.mockRejectedValue(new Error('ECONNREFUSED'));

    await relay.flush();

    expect(update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: {
        attempts: 1,
        lastError: 'ECONNREFUSED',
        status: OutboxStatus.PENDING,
      },
    });
  });

  it('parks a row that keeps failing, so it stops blocking the queue', async () => {
    const { relay, publish, update } = build([
      row({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }),
    ]);
    publish.mockRejectedValue(new Error('unknown topic'));

    await relay.flush();

    expect(update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: expect.objectContaining({
        status: OutboxStatus.FAILED,
        attempts: OUTBOX_MAX_ATTEMPTS,
      }) as unknown,
    });
  });

  it('never rejects, so a scheduler tick cannot take the worker down', async () => {
    const { relay, findMany } = build([]);
    findMany.mockRejectedValue(new Error('the database is gone'));

    await expect(relay.flush()).resolves.toBeUndefined();
  });

  it('does not start a second pass while one is still running', async () => {
    const { relay, findMany } = build([]);
    let release: () => void = () => undefined;
    findMany.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );

    const first = relay.flush();
    await relay.flush();
    release();
    await first;

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps failed rows when it cleans up the published ones', async () => {
    // A FAILED row is the one somebody still has to act on.
    const { relay, deleteMany } = build([]);

    await relay.cleanupPublished();

    const [{ where }] = deleteMany.mock.calls[0] as [
      { where: { status: string } },
    ];
    expect(where.status).toBe(OutboxStatus.SENT);
  });
});
