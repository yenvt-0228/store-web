import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { I18nService } from 'nestjs-i18n';
import { REPORT_JOB_OPTIONS } from '../queue/queue.constant';
import { StorageService } from '../upload/storage.service';
import { OrderReportDto } from './dto/order-report.dto';
import { REPORT_QUEUE, ReportJob, XLSX_MIME } from './report.constant';
import { OrderReportResult, ReportJobStatus } from './report.interface';

/**
 * Reduces a value to what is safe inside a quoted `filename=` parameter.
 *
 * @param value - Value to embed in the header.
 * @returns The value with everything but letters, digits, `-` and `_` removed.
 */
function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '') || 'report';
}

@Injectable()
export class ReportService {
  constructor(
    private readonly i18n: I18nService,
    private readonly storage: StorageService,
    @Optional() @InjectQueue(REPORT_QUEUE) private readonly queue?: Queue,
  ) {}

  /**
   * Queues an orders export and returns straight away.
   *
   * @param dto - Date range and status filters for the export.
   * @param requestedBy - Id of the admin asking for the report.
   * @returns The id of the queued job, used to poll status and download.
   * @throws {ServiceUnavailableException} When the report queue is disabled.
   */
  async requestOrderReport(
    dto: OrderReportDto,
    requestedBy: string,
  ): Promise<{ jobId: string }> {
    const job = await this.requireQueue().add(
      ReportJob.ORDERS_XLSX,
      { ...dto, requestedBy },
      REPORT_JOB_OPTIONS,
    );

    return { jobId: String(job.id) };
  }

  /**
   * Reads the current state of a queued export.
   *
   * @param jobId - Job id returned by {@link ReportService.requestOrderReport}.
   * @returns State, progress, result and failure reason of the job.
   * @throws {NotFoundException} When the job is unknown or past its retention.
   * @throws {ServiceUnavailableException} When the report queue is disabled.
   */
  async status(jobId: string): Promise<ReportJobStatus> {
    const job = await this.requireQueue().getJob(jobId);

    if (!job) {
      throw new NotFoundException(this.i18n.t('report.JOB_NOT_FOUND'));
    }

    return {
      jobId,
      state: await job.getState(),
      progress: typeof job.progress === 'number' ? job.progress : 0,
      result: (job.returnvalue as OrderReportResult | null) ?? null,
      failedReason: job.failedReason ?? null,
    };
  }

  /**
   * Streams the finished report back to the caller.
   *
   * The file is served through here rather than a storage URL: the request has
   * to pass `JwtAuthGuard` + `RolesGuard(ADMIN)` before any customer data is
   * read.
   *
   * @param jobId - Job id of a completed export.
   * @returns The xlsx file as a downloadable attachment.
   * @throws {NotFoundException} When the job is unknown, has not finished, or
   * its file has already been cleaned up.
   */
  async download(jobId: string): Promise<StreamableFile> {
    const status = await this.status(jobId);

    if (status.state !== 'completed' || !status.result) {
      throw new NotFoundException(this.i18n.t('report.NOT_READY'));
    }

    const buffer = await this.storage.get(status.result.objectKey);

    if (!buffer) {
      throw new NotFoundException(this.i18n.t('report.FILE_GONE'));
    }

    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      // `jobId` comes from the URL. A job with a quote or a newline in its id
      // cannot exist today, so this is not reachable — but interpolating a path
      // parameter into a response header is one BullMQ change away from being a
      // header injection, and stripping it costs nothing.
      disposition: `attachment; filename="orders-${safeFilenamePart(jobId)}.xlsx"`,
    });
  }

  /**
   * Returns the report queue, or fails loudly when it is not configured.
   *
   * There is deliberately no "build it inline" fallback: an xlsx is synchronous
   * CPU work, and doing it inside a request blocks the whole API, which is
   * exactly what the queue exists to avoid.
   *
   * @returns The injected BullMQ queue.
   * @throws {ServiceUnavailableException} When the report queue is disabled.
   */
  private requireQueue(): Queue {
    if (!this.queue) {
      throw new ServiceUnavailableException(
        this.i18n.t('report.QUEUE_DISABLED'),
      );
    }

    return this.queue;
  }
}
