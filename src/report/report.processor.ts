import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../upload/storage.service';
import { OrderReportSource } from './order-report.source';
import {
  OrderReportPayload,
  OrderReportResult,
  REPORT_QUEUE,
  XLSX_MIME,
} from './report.constant';
import { XlsxThreadRunner } from './xlsx-thread.runner';

@Processor(REPORT_QUEUE)
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(
    private source: OrderReportSource,
    private xlsx: XlsxThreadRunner,
    private storage: StorageService,
    private prisma: PrismaService,
  ) {
    super();
  }

  // Job chia làm ba đoạn rõ rệt: đọc DB (I/O, ở đây) → dựng file (CPU, ở thread
  // khác) → đẩy S3 (I/O, ở đây). Chỉ đoạn giữa là thứ chặn event loop nếu để
  // nguyên trong process, nên chỉ đoạn giữa được đưa sang worker thread.
  async process(job: Job<OrderReportPayload>): Promise<OrderReportResult> {
    const { rows, truncated } = await this.source.collect(job.data);
    await job.updateProgress(40);

    const { buffer, buildMs } = await this.xlsx.run({
      rows,
      title: 'Đơn hàng',
    });
    await job.updateProgress(80);

    // Key ngẫu nhiên, không phải job.id: id tăng dần thì đoán được key của báo
    // cáo do người khác xuất.
    const objectKey = `reports/orders-${randomUUID()}.xlsx`;
    const url = await this.storage.put(objectKey, buffer, XLSX_MIME);

    // Ghi sổ như mọi object khác để ImageCleanupService dọn: không dòng nào
    // trong images/users trỏ tới nên nó bị xoá sau 24h ân hạn — trùng đúng thời
    // gian job được giữ trong queue.
    await this.prisma.uploadedObject.create({ data: { objectKey, url } });

    await job.updateProgress(100);

    this.logger.log(
      `Báo cáo đơn hàng job#${job.id}: ${rows.length} dòng${truncated ? ' (BỊ CẮT)' : ''} → ${objectKey} (${buildMs}ms dựng file)`,
    );

    if (truncated) {
      this.logger.warn(
        `job#${job.id} vượt giới hạn dòng — báo cáo chỉ có đơn mới nhất, admin cần thu hẹp khoảng ngày.`,
      );
    }

    return {
      objectKey,
      rows: rows.length,
      bytes: buffer.byteLength,
      buildMs,
      truncated,
    };
  }
}
