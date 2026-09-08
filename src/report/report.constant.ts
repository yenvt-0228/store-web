export const REPORT_QUEUE = 'report';

export const ReportJob = {
  ORDERS_XLSX: 'orders-xlsx',
} as const;

// Worksheet tab name of the exported file. The report is read by Vietnamese
// admins, so the rendered output stays in Vietnamese while the code around it
// does not.
export const ORDERS_SHEET_TITLE = 'Đơn hàng';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Row ceiling: a bigger sheet means a bigger buffer inside the worker thread,
// and that memory belongs to the same process. 50k rows is roughly an 8-10MB
// file, enough for a monthly report.
export const MAX_REPORT_ROWS = 50_000;

// A stuck job (exceljs choking on odd data, thread never posting back) has to
// end instead of holding a live thread forever.
export const XLSX_TIMEOUT_MS = 60_000;
