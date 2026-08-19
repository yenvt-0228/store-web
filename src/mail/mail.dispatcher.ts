import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MAIL_QUEUE, MailJob, MailPayload } from './mail.constant';
import { MailService } from './mail.service';

const ENQUEUE_TIMEOUT_MS = 2000;

@Injectable()
export class MailDispatcher {
  private readonly logger = new Logger(MailDispatcher.name);

  constructor(
    private mailService: MailService,
    @Optional() @InjectQueue(MAIL_QUEUE) private queue?: Queue,
  ) {}

  async dispatch(payload: MailPayload): Promise<void> {
    if (this.queue) {
      try {
        await this.withTimeout(
          this.queue.add(MailJob.SEND, payload, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          }),
          ENQUEUE_TIMEOUT_MS,
        );
        return;
      } catch (error) {
        this.logger.warn(
          `Không đẩy được job vào queue (${(error as Error).message}), gửi trực tiếp.`,
        );
      }
    }

    await this.sendSafely(payload);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`queue không phản hồi sau ${ms}ms`)),
          ms,
        ).unref();
      }),
    ]);
  }

  private async sendSafely(payload: MailPayload): Promise<void> {
    try {
      await this.mailService.send(payload);
    } catch (error) {
      this.logger.error(
        `Gửi mail tới ${payload.to} thất bại: ${(error as Error).message}`,
      );
    }
  }
}
