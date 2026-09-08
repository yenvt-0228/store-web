import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { I18nService } from 'nestjs-i18n';
import { StorageService } from '../upload/storage.service';
import { OrderReportDto } from './dto/order-report.dto';
import { OrderReportResult, REPORT_QUEUE, ReportJob } from './report.constant';

export interface ReportJobStatus {
  jobId: string;
  state: string;
  progress: number;
  result: OrderReportResult | null;
  failedReason: string | null;
}

export interface ReportDownload {
  buffer: Buffer;
  filename: string;
}

@Injectable()
export class ReportService {
  constructor(
    private i18n: I18nService,
    private storage: StorageService,
    @Optional() @InjectQueue(REPORT_QUEUE) private queue?: Queue,
  ) {}

  async requestOrderReport(
    dto: OrderReportDto,
    requestedBy: string,
  ): Promise<{ jobId: string }> {
    const job = await this.requireQueue().add(
      ReportJob.ORDERS_XLSX,
      { ...dto, requestedBy },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        // Giữ job đã xong 24h: client phải đọc lại được URL file sau khi job kết
        // thúc, xoá ngay là mất luôn kết quả.
        removeOnComplete: { age: 24 * 60 * 60, count: 200 },
        removeOnFail: { age: 24 * 60 * 60, count: 200 },
      },
    );

    return { jobId: String(job.id) };
  }

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

  // File tải qua đây chứ không qua URL công khai: request phải đi qua
  // JwtAuthGuard + RolesGuard(ADMIN) mới lấy được dữ liệu khách hàng.
  async download(jobId: string): Promise<ReportDownload> {
    const status = await this.status(jobId);

    if (status.state !== 'completed' || !status.result) {
      throw new NotFoundException(this.i18n.t('report.NOT_READY'));
    }

    const buffer = await this.storage.get(status.result.objectKey);

    if (!buffer) {
      throw new NotFoundException(this.i18n.t('report.FILE_GONE'));
    }

    return { buffer, filename: `orders-${jobId}.xlsx` };
  }

  // Không có fallback "dựng file ngay trong request": file xlsx là CPU-bound
  // đồng bộ, làm trong request là chặn cả API — đúng thứ queue sinh ra để tránh.
  private requireQueue(): Queue {
    if (!this.queue) {
      throw new ServiceUnavailableException(
        this.i18n.t('report.QUEUE_DISABLED'),
      );
    }

    return this.queue;
  }
}
