import ExcelJS from 'exceljs';
import { buildOrdersSheet } from './orders-sheet';
import { ORDERS_SHEET_TITLE } from './report.constant';
import { OrderReportRow } from './report.interface';

function row(overrides: Partial<OrderReportRow> = {}): OrderReportRow {
  return {
    orderCode: 'DH-001',
    createdAt: '2026-09-07T03:00:00.000Z',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'COD',
    customerName: 'Nguyễn Văn A',
    customerEmail: 'a@store-web.local',
    shippingPhone: '0900000001',
    shippingAddress: '1 Đường A, Quận 1',
    itemCount: 2,
    totalAmount: 1234.56,
    ...overrides,
  };
}

// exceljs/index.d.ts line 1 declares `interface Buffer extends ArrayBuffer {}`,
// merging into Node's global Buffer. That makes load() demand a value that is
// both a Buffer and an ArrayBuffer, which nothing real satisfies. The typing bug
// is in exceljs, not at the call site, so casting here is the only way to keep
// `tsc --noEmit` clean; at runtime a plain Buffer is what it gets.
async function reload(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  return workbook;
}

describe('buildOrdersSheet', () => {
  it('returns a readable xlsx with the right row count and untouched amounts', async () => {
    const buffer = await buildOrdersSheet({
      rows: [row(), row({ orderCode: 'DH-002', totalAmount: 99 })],
      title: ORDERS_SHEET_TITLE,
    });

    // ZIP signature: an xlsx is a zip, so a wrong header means a broken file.
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const reloaded = await reload(buffer);

    const sheet = reloaded.getWorksheet(ORDERS_SHEET_TITLE);
    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBe(3); // 1 header + 2 data rows

    expect(sheet!.getRow(1).getCell(1).value).toBe('Mã đơn');
    expect(sheet!.getRow(2).getCell(1).value).toBe('DH-001');
    // The amount must be a number, not a string: as a string Excel cannot sum
    // the column.
    expect(sheet!.getRow(2).getCell(11).value).toBe(1234.56);
    expect(sheet!.getRow(3).getCell(11).value).toBe(99);
  });

  it('still returns a valid header-only file when there are no orders', async () => {
    const buffer = await buildOrdersSheet({
      rows: [],
      title: ORDERS_SHEET_TITLE,
    });

    const reloaded = await reload(buffer);

    expect(reloaded.getWorksheet(ORDERS_SHEET_TITLE)!.rowCount).toBe(1);
  });
});
