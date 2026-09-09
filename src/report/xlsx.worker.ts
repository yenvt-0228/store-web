import { parentPort, workerData } from 'node:worker_threads';
import { buildOrdersSheet } from './orders-sheet';
import { OrdersSheetRequest } from './report.interface';

/**
 * Entry point of the worker thread. This file runs INSIDE the thread, outside
 * the Nest DI container, so it deliberately imports nothing from Nest, reads no
 * environment variables and opens no database or storage connection: it takes
 * data, computes, returns a result. All I/O is already done by
 * `ReportProcessor`.
 *
 * @returns Resolves once the rendered bytes have been posted to the parent.
 * @throws {Error} When the file is loaded outside a worker thread.
 */
async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error('xlsx.worker must be started as a worker thread.');
  }

  const buffer = await buildOrdersSheet(workerData as OrdersSheetRequest);

  // Copy into a standalone ArrayBuffer before transferring: a Node Buffer may
  // sit on the shared memory pool, and transferring that ArrayBuffer would
  // detach every other Buffer sharing the same block.
  const payload = new Uint8Array(buffer.byteLength);
  payload.set(buffer);

  parentPort.postMessage(payload, [payload.buffer]);
}

void main().catch((error: unknown) => {
  // Rethrow so the parent thread's 'error' event fires instead of the thread
  // dying silently.
  throw error instanceof Error ? error : new Error(String(error));
});
