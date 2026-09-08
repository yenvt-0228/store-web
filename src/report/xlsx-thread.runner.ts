import { Injectable, Logger } from '@nestjs/common';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { XLSX_TIMEOUT_MS } from './report.constant';
import { OrdersSheetRequest, XlsxThreadResult } from './report.interface';

@Injectable()
export class XlsxThreadRunner {
  private readonly logger = new Logger(XlsxThreadRunner.name);

  // Points at the built file. `nest start` also runs from dist, so this path is
  // correct in both development and production; tests call buildOrdersSheet()
  // directly instead.
  private readonly workerPath = join(__dirname, 'xlsx.worker.js');

  /**
   * Builds one workbook on a dedicated worker thread.
   *
   * One thread per job rather than a pool: a report job runs for seconds while
   * spawning a thread costs tens of milliseconds, which is not worth the pool
   * lifecycle management.
   *
   * @param request - Rows and sheet title to render.
   * @returns The xlsx bytes and how long the build took.
   * @throws {Error} When the thread exceeds {@link XLSX_TIMEOUT_MS}, reports an
   * error, or exits with a non-zero code before posting a result.
   */
  async run(request: OrdersSheetRequest): Promise<XlsxThreadResult> {
    const startedAt = Date.now();

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const worker = new Worker(this.workerPath, { workerData: request });

      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          new Error(
            `Building the xlsx took longer than ${XLSX_TIMEOUT_MS}ms, worker thread terminated.`,
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
        // If 'message' already resolved, this reject is ignored; it only
        // matters when the thread dies before sending anything back.
        if (code !== 0) {
          settle(() =>
            reject(new Error(`Worker thread exited with code ${code}.`)),
          );
        }
      });
    });

    const buildMs = Date.now() - startedAt;

    this.logger.log(
      `Built xlsx: ${request.rows.length} rows, ${buffer.byteLength} bytes, ${buildMs}ms (worker thread).`,
    );

    return { buffer, buildMs };
  }
}
