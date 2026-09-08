import { Injectable, Logger } from '@nestjs/common';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { OrdersSheetRequest } from './orders-sheet';
import { XLSX_TIMEOUT_MS } from './report.constant';

export interface XlsxThreadResult {
  buffer: Buffer;
  buildMs: number;
}

@Injectable()
export class XlsxThreadRunner {
  private readonly logger = new Logger(XlsxThreadRunner.name);

  // Trỏ vào file đã build. `nest start` cũng chạy từ dist nên đường dẫn này đúng
  // ở cả dev và production; test thì gọi buildOrdersSheet() trực tiếp.
  private readonly workerPath = join(__dirname, 'xlsx.worker.js');

  // Một thread cho mỗi job thay vì pool: job báo cáo chạy hàng giây, còn spawn
  // thread chỉ mất vài chục ms — không đáng để tự quản lý vòng đời của pool.
  async run(request: OrdersSheetRequest): Promise<XlsxThreadResult> {
    const startedAt = Date.now();

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const worker = new Worker(this.workerPath, { workerData: request });

      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          new Error(
            `Dựng xlsx quá ${XLSX_TIMEOUT_MS}ms, đã huỷ worker thread.`,
          ),
        );
      }, XLSX_TIMEOUT_MS);

      const settle = (fn: () => void) => {
        clearTimeout(timer);
        fn();
      };

      worker.once('message', (payload: Uint8Array) => {
        settle(() =>
          resolve(Buffer.from(payload.buffer, 0, payload.byteLength)),
        );
      });

      worker.once('error', (error: unknown) =>
        settle(() =>
          reject(error instanceof Error ? error : new Error(String(error))),
        ),
      );

      worker.once('exit', (code) => {
        // 'message' đã resolve trước thì promise bỏ qua reject này; chỉ còn tác
        // dụng khi thread chết mà chưa gửi gì về.
        if (code !== 0) {
          settle(() =>
            reject(new Error(`worker thread thoát với mã ${code}.`)),
          );
        }
      });
    });

    const buildMs = Date.now() - startedAt;

    this.logger.log(
      `Dựng xlsx xong: ${request.rows.length} dòng, ${buffer.byteLength} byte, ${buildMs}ms (worker thread).`,
    );

    return { buffer, buildMs };
  }
}
