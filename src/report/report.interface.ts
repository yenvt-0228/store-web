import { OrderStatus } from '../generated/prisma/enums';

// What the caller asks for. Dates arrive as ISO strings because the payload
// travels through the queue as JSON.
export interface OrderReportPayload {
  from?: string;
  to?: string;
  status?: OrderStatus;
  requestedBy: string;
}

export interface OrderReportResult {
  // Object key only, never a public URL: the file holds customer emails, phone
  // numbers and addresses, so the download endpoint is the only way in.
  objectKey: string;
  rows: number;
  bytes: number;
  buildMs: number;
  truncated: boolean;
}

export interface ReportJobStatus {
  jobId: string;
  state: string;
  progress: number;
  result: OrderReportResult | null;
  failedReason: string | null;
}

// One flattened order. Prisma Decimal and Date do not survive the structured
// clone into the worker thread, so they are reduced to number and string here.
export interface OrderReportRow {
  orderCode: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  customerName: string;
  customerEmail: string;
  shippingPhone: string;
  shippingAddress: string;
  itemCount: number;
  totalAmount: number;
}

export interface CollectedOrders {
  rows: OrderReportRow[];
  // true when more orders matched the filter but were cut at MAX_REPORT_ROWS.
  truncated: boolean;
}

export interface OrdersSheetRequest {
  rows: OrderReportRow[];
  title: string;
}

export interface XlsxThreadResult {
  buffer: Buffer;
  buildMs: number;
}
