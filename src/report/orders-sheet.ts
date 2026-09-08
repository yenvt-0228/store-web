import ExcelJS from 'exceljs';

// Dòng đã được làm phẳng ở phía Nest: Decimal/Date của Prisma không đi qua
// structured clone sang worker thread một cách đáng tin, nên quy về number/string
// trước khi truyền.
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

export interface OrdersSheetRequest {
  rows: OrderReportRow[];
  title: string;
}

interface ColumnSpec {
  header: string;
  key: keyof OrderReportRow;
  width: number;
  numeric?: boolean;
}

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

// Đây là phần ngốn CPU: exceljs dựng XML rồi zip lại, tất cả bằng JS thuần và
// đồng bộ. Hàm được tách riêng khỏi worker thread để test gọi trực tiếp được.
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
