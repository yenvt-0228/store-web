import ExcelJS from 'exceljs';
import { OrderReportRow, OrdersSheetRequest } from './report.interface';

interface ColumnSpec {
  header: string;
  key: keyof OrderReportRow;
  width: number;
  numeric?: boolean;
}

// Column headers are the rendered output of the report, read by Vietnamese
// admins, so they stay in Vietnamese while `key` keeps the English field name
// the rest of the code uses.
const COLUMNS: ColumnSpec[] = [
  { header: 'Mã đơn', key: 'orderCode', width: 22 },
  { header: 'Ngày tạo', key: 'createdAt', width: 20 },
  { header: 'Trạng thái', key: 'status', width: 14 },
  { header: 'Thanh toán', key: 'paymentStatus', width: 14 },
  { header: 'Phương thức', key: 'paymentMethod', width: 16 },
  { header: 'Khách hàng', key: 'customerName', width: 24 },
  { header: 'Email', key: 'customerEmail', width: 28 },
  { header: 'Điện thoại', key: 'shippingPhone', width: 16 },
  { header: 'Địa chỉ giao', key: 'shippingAddress', width: 40 },
  { header: 'Số món', key: 'itemCount', width: 10, numeric: true },
  { header: 'Thành tiền', key: 'totalAmount', width: 16, numeric: true },
];

/**
 * Renders the orders worksheet into an xlsx buffer.
 *
 * This is the CPU-bound part: exceljs builds the XML and zips it, all in plain
 * synchronous JavaScript. Kept separate from the worker thread entry point so
 * tests can call it directly.
 *
 * @param request - Flattened order rows and the worksheet tab name.
 * @returns The complete xlsx file as a buffer.
 */
export async function buildOrdersSheet(
  request: OrdersSheetRequest,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(request.title, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = COLUMNS.map(({ header, key, width }) => ({
    header,
    key,
    width,
  }));

  sheet.getRow(1).font = { bold: true };

  for (const row of request.rows) {
    sheet.addRow(row);
  }

  for (const [index, column] of COLUMNS.entries()) {
    if (!column.numeric) continue;
    sheet.getColumn(index + 1).numFmt = '#,##0.00';
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  const written = await workbook.xlsx.writeBuffer();

  return Buffer.from(written);
}
