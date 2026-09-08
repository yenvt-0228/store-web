import { OrderStatus } from '../generated/prisma/enums';

export const REPORT_QUEUE = 'report';

export const ReportJob = {
  ORDERS_XLSX: 'orders-xlsx',
} as const;

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Chặn trên số dòng: file càng lớn thì thread càng ngốn RAM, mà RAM của thread
// tính vào cùng một process. 50k dòng ~ 8-10MB xlsx, đủ cho báo cáo tháng.
export const MAX_REPORT_ROWS = 50_000;

// Job treo (exceljs gặp dữ liệu lạ, thread không postMessage) thì phải kết thúc
// chứ không giữ thread sống mãi.
export const XLSX_TIMEOUT_MS = 60_000;

export interface OrderReportPayload {
  from?: string;
  to?: string;
  status?: OrderStatus;
  requestedBy: string;
}

export interface OrderReportResult {
  // Chỉ trả key, KHÔNG trả URL công khai: file chứa email/điện thoại/địa chỉ
  // khách hàng, chỉ tải được qua endpoint download đã xác thực.
  objectKey: string;
  rows: number;
  bytes: number;
  buildMs: number;
  truncated: boolean;
}
