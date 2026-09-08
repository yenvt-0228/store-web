import { parentPort, workerData } from 'node:worker_threads';
import { buildOrdersSheet, OrdersSheetRequest } from './orders-sheet';

// Điểm vào của worker thread — file này chạy TRONG thread, không phải trong
// container DI của Nest. Vì vậy nó cố tình không import gì thuộc Nest, không đọc
// biến môi trường, không mở kết nối DB/S3: chỉ nhận dữ liệu, tính, trả kết quả.
// Mọi thứ cần I/O đã làm xong ở phía ReportProcessor.
async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error('xlsx.worker phải được chạy như worker thread.');
  }

  const buffer = await buildOrdersSheet(workerData as OrdersSheetRequest);

  // Copy sang một ArrayBuffer độc lập rồi transfer: Buffer của Node có thể nằm
  // trên vùng nhớ pool dùng chung, transfer thẳng ArrayBuffer đó sẽ vô hiệu hoá
  // cả những Buffer khác đang chia sẻ vùng nhớ ấy.
  const payload = new Uint8Array(buffer.byteLength);
  payload.set(buffer);

  parentPort.postMessage(payload, [payload.buffer]);
}

void main().catch((error: unknown) => {
  // Ném lại để 'error' event ở thread cha bắt được, thay vì thread chết im lặng.
  throw error instanceof Error ? error : new Error(String(error));
});
