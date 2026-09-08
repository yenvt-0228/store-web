import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../upload/storage.service';
import { OrderReportSource } from './order-report.source';
import { ORDERS_SHEET_TITLE, REPORT_QUEUE, XLSX_MIME } from './report.constant';
import { OrderReportPayload, OrderReportResult } from './report.interface';
import { XlsxThreadRunner } from './xlsx-thread.runner';

const PROGRESS = {
  COLLECTED: 40,
  BUILT: 80,
  UPLOADED: 100,
} as const;

@Processor(REPORT_QUEUE)
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(
    private readonly source: OrderReportSource,
    private readonly xlsx: XlsxThreadRunner,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  /**
   * Runs one report job in three clear stages: read the database (I/O, here) ->
   * build the file (CPU, on another thread) -> upload to S3 (I/O, here). Only
   * the middle stage would block the event loop, so only it moves off-thread.
   *
   * @param job - Queued job carrying the report filters.
   * @returns The stored object key plus row, size and timing counters.
   * @throws Rethrows any stage error so BullMQ can retry the job.
   */
  async process(job: Job<OrderReportPayload>): Promise<OrderReportResult> {
    try {
      const { rows, truncated } = await this.source.collect(job.data);
      await job.updateProgress(PROGRESS.COLLECTED);

      const { buffer, buildMs } = await this.xlsx.run({
        rows,
        title: ORDERS_SHEET_TITLE,
      });
      await job.updateProgress(PROGRESS.BUILT);

      const objectKey = await this.store(job, buffer);
      await job.updateProgress(PROGRESS.UPLOADED);

      this.logger.log(
        `Orders report job#${job.id}: ${rows.length} rows${truncated ? ' (TRUNCATED)' : ''} -> ${objectKey} (${buildMs}ms to build)`,
      );

      if (truncated) {
        this.logger.warn(
          `job#${job.id} hit the row limit — the report only holds the most recent orders, the admin should narrow the date range.`,
        );
      }

      return {
        objectKey,
        rows: rows.length,
        bytes: buffer.byteLength,
        buildMs,
        truncated,
      };
    } catch (error) {
      // A failure here is not final: BullMQ still has retries left, so this is
      // logged as a warning and rethrown. Treating the first error as a
      // terminal failure would mark a job that is about to succeed as broken.
      this.logger.warn(
        `Report job#${job.id} failed attempt ${job.attemptsMade + 1}/${this.maxAttempts(job)}: ${this.reasonOf(error)}`,
      );

      throw error;
    }
  }

  /**
   * Logs the terminal failure of a job, i.e. the point where BullMQ has given
   * up and the job can honestly be called failed.
   *
   * `finishedOn` is the signal rather than a count of attempts: BullMQ stamps
   * it only on the branch that really moves the job to failed, and leaves it
   * unset when the attempt is sent back to delayed/wait for a retry. Comparing
   * `attemptsMade` against `opts.attempts` would miss an `UnrecoverableError`,
   * which ends a job on its first failure while attempts are still left.
   *
   * @param job - The failed job, or `undefined` when BullMQ could not load it.
   * @param error - The error raised by the last attempt.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<OrderReportPayload> | undefined, error: Error): void {
    if (!job) {
      this.logger.error(
        `Report job failed before its data could be read: ${error?.message ?? 'unknown error'}`,
      );
      return;
    }

    if (!job.finishedOn) return;

    this.logger.error(
      `Report job#${job.id} failed for good after ${job.attemptsMade}/${this.maxAttempts(job)} attempts: ${error?.message ?? 'unknown error'}`,
    );
  }

  /**
   * Logs a job whose lock expired while it was active.
   *
   * A stalled job is moved back to wait by BullMQ, and once it stalls more than
   * `maxStalledCount` times the Lua script fails it server-side without the
   * worker ever emitting `failed`. Without this handler such a job would
   * disappear from the logs entirely.
   *
   * @param jobId - Id of the job that lost its lock.
   */
  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.error(
      `Report job#${jobId} stalled: the lock expired while it was active. It goes back to wait, and is failed by BullMQ once it exceeds maxStalledCount.`,
    );
  }

  /**
   * Uploads the built workbook and records it in `uploaded_objects`.
   *
   * The key is random rather than derived from `job.id`: a sequential id would
   * let anyone guess the key of a report somebody else exported. The
   * `uploaded_objects` row is what lets `ImageCleanupService` purge the file
   * after its grace period.
   *
   * @param job - Job the file belongs to.
   * @param buffer - The xlsx bytes to store.
   * @returns The object key the file was stored under.
   */
  private async store(
    job: Job<OrderReportPayload>,
    buffer: Buffer,
  ): Promise<string> {
    const objectKey = `reports/orders-${randomUUID()}.xlsx`;
    const url = await this.storage.put(objectKey, buffer, XLSX_MIME);

    await this.prisma.uploadedObject.create({ data: { objectKey, url } });

    return objectKey;
  }

  /**
   * @param job - Job to inspect.
   * @returns How many attempts BullMQ makes before the job counts as failed.
   */
  private maxAttempts(job: Job<OrderReportPayload>): number {
    return job.opts.attempts ?? 1;
  }

  /**
   * @param error - Any thrown value.
   * @returns Its message, or the stringified value when it is not an `Error`.
   */
  private reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
