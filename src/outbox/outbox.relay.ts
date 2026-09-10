import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { OutboxStatus } from '../generated/prisma/enums';
import type { OutboxEvent } from '../generated/prisma/client';
import { KafkaEventName } from '../kafka/kafka.constant';
import { KafkaProducer } from '../kafka/kafka.producer';
import { PrismaService } from '../prisma/prisma.service';
import {
  OUTBOX_BATCH_SIZE,
  OUTBOX_ERROR_MAX_LENGTH,
  OUTBOX_KEEP_SENT_DAYS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_POLL_INTERVAL_MS,
} from './outbox.constant';

/**
 * Publishes the events the services queued in the outbox table.
 *
 * Only registered in the process that runs background work, and it reads the
 * table without locking: two relays racing over the same rows would publish
 * them twice and, worse, out of order. The consumer would survive that — every
 * message carries the outbox row id as its `eventId` and duplicates are dropped
 * — but the ordering a Kafka key is supposed to guarantee would not.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  // A tick that overruns the interval must not start a second pass over rows
  // the first one is still publishing.
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: KafkaProducer,
  ) {}

  @Interval(OUTBOX_POLL_INTERVAL_MS)
  async flush(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      await this.publishPending();
    } catch (error) {
      // The tick must never reject: an unhandled rejection out of a scheduler
      // callback takes the worker down.
      this.logger.error(
        `Draining the outbox failed: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async publishPending(): Promise<void> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: OutboxStatus.PENDING },
      // Oldest first: `order.created` was written before `order.confirmed`, and
      // that is the order they have to reach the topic in.
      orderBy: { createdAt: 'asc' },
      take: OUTBOX_BATCH_SIZE,
    });

    if (pending.length === 0) {
      return;
    }

    let published = 0;

    for (const row of pending) {
      try {
        await this.producer.publish({
          topic: row.topic,
          key: row.eventKey,
          eventName: row.eventName as KafkaEventName,
          payload: row.payload,
          // The row id is the event id, so a row published twice — the send
          // succeeded but the process died before the row was marked sent —
          // arrives with an id the consumer has already seen.
          eventId: row.id,
          // When the event happened, not when it was finally delivered.
          occurredAt: row.createdAt.toISOString(),
        });
      } catch (error) {
        await this.recordFailure(row, error as Error);
        // Stop the batch. The broker being unreachable is the usual reason, so
        // the rest would fail too, and publishing past a stuck row would put
        // one order's events on the topic in the wrong order.
        break;
      }

      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          status: OutboxStatus.SENT,
          attempts: row.attempts + 1,
          lastError: null,
          publishedAt: new Date(),
        },
      });
      published++;
    }

    if (published > 0) {
      // Not `published/pending.length`: the batch stops at the first failure,
      // so the rows it never got to are not failures to report.
      this.logger.log(`Published ${published} outbox event(s).`);
    }
  }

  private async recordFailure(row: OutboxEvent, error: Error): Promise<void> {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= OUTBOX_MAX_ATTEMPTS;

    await this.prisma.outboxEvent.update({
      where: { id: row.id },
      data: {
        attempts,
        lastError: error.message.slice(0, OUTBOX_ERROR_MAX_LENGTH),
        // Left PENDING so the next tick tries again; parked as FAILED once
        // retrying is clearly not going to help, because a row that keeps
        // failing would otherwise block every event queued behind it.
        status: exhausted ? OutboxStatus.FAILED : OutboxStatus.PENDING,
      },
    });

    const detail = `${row.eventName} (key ${row.eventKey}, attempt ${attempts}): ${error.message}`;

    if (exhausted) {
      // Worth saying out loud: parking the row unblocks the queue, but later
      // events for the SAME order will now be published without it — a consumer
      // can see `order.confirmed` for an order it never saw created. That is the
      // price of not blocking every other order behind one poisoned row, and it
      // is why this is an error and not a warning.
      this.logger.error(
        `Giving up on outbox event ${row.id} — ${detail}. The row is kept as FAILED; until it is replayed by hand, later events for ${row.eventKey} reach consumers without it.`,
      );
      return;
    }

    this.logger.warn(`Outbox event ${row.id} not published — ${detail}`);
  }

  /**
   * Drops the rows that were published long enough ago to be uninteresting.
   *
   * FAILED rows are never deleted: they are the ones somebody still has to act
   * on.
   *
   * @returns Resolves once the old rows are gone.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupPublished(): Promise<void> {
    const keepUntil = new Date(
      Date.now() - OUTBOX_KEEP_SENT_DAYS * 24 * 60 * 60 * 1000,
    );

    // Same reason as `flush`: nothing awaits a scheduler callback, so a
    // rejection here is an unhandled rejection and the worker exits over a
    // cleanup that could simply have waited for tomorrow.
    try {
      const { count } = await this.prisma.outboxEvent.deleteMany({
        where: { status: OutboxStatus.SENT, publishedAt: { lt: keepUntil } },
      });

      this.logger.log(`Cleaned up ${count} published outbox event(s).`);
    } catch (error) {
      this.logger.error(
        `Cleaning up published outbox events failed: ${(error as Error).message}`,
      );
    }
  }
}
