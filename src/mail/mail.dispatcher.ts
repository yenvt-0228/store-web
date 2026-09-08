import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DEFAULT_JOB_OPTIONS } from '../queue/queue.constant';
import { MAIL_QUEUE, MailJob, MailPayload } from './mail.constant';
import { MailService } from './mail.service';

const ENQUEUE_TIMEOUT_MS = 2000;

@Injectable()
export class MailDispatcher {
  private readonly logger = new Logger(MailDispatcher.name);

  constructor(
    private readonly mailService: MailService,
    @Optional() @InjectQueue(MAIL_QUEUE) private readonly queue?: Queue,
  ) {}

  /**
   * Hands a mail off to the queue, falling back to sending it inline.
   *
   * A queue outage must not fail the request that triggered the mail, so an
   * enqueue failure degrades to a direct send instead of throwing.
   *
   * @param payload - Recipient, template and template variables.
   * @returns Resolves once the mail is queued or has been sent directly.
   */
  async dispatch(payload: MailPayload): Promise<void> {
    if (this.queue) {
      try {
        await this.withTimeout(
          this.queue.add(MailJob.SEND, payload, DEFAULT_JOB_OPTIONS),
          ENQUEUE_TIMEOUT_MS,
        );
        return;
      } catch (error) {
        this.logger.warn(
          `Could not enqueue the job (${(error as Error).message}), sending directly.`,
        );
      }
    }

    await this.sendSafely(payload);
  }

  /**
   * Caps how long an operation may take.
   *
   * @param promise - Operation to race against the deadline.
   * @param ms - Deadline in milliseconds.
   * @returns The settled value of `promise`.
   * @throws {Error} When the deadline passes first.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`the queue did not respond within ${ms}ms`)),
          ms,
        ).unref();
      }),
    ]);
  }

  /**
   * Sends a mail and swallows any failure, logging it instead.
   *
   * @param payload - Recipient, template and template variables.
   * @returns Resolves whether or not the mail went out.
   */
  private async sendSafely(payload: MailPayload): Promise<void> {
    try {
      await this.mailService.send(payload);
    } catch (error) {
      this.logger.error(
        `Sending mail to ${payload.to} failed: ${(error as Error).message}`,
      );
    }
  }
}
