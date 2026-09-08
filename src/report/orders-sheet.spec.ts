import ExcelJS from 'exceljs';
import { buildOrdersSheet, OrderReportRow } from './orders-sheet';

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

// exceljs/index.d.ts dòng 1 khai báo `interface Buffer extends ArrayBuffer {}`,
// merge vào global Buffer của Node. Vì vậy load() đòi một Buffer đồng thời là
// ArrayBuffer — không giá trị thật nào thoả mãn được. Lỗi typing nằm ở exceljs,
// không phải ở chỗ gọi, nên ép kiểu ở đây là cách duy nhất mà vẫn giữ
// `tsc --noEmit` xanh; runtime nhận Buffer bình thường.
async function reload(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  return workbook;
}

describe('buildOrdersSheet', () => {
  it('trả về file xlsx đọc lại được, đúng số dòng và giữ nguyên số tiền', async () => {
    const buffer = await buildOrdersSheet({
      rows: [row(), row({ orderCode: 'DH-002', totalAmount: 99 })],
      title: 'Đơn hàng',
    });

    // Chữ ký ZIP — xlsx là một file zip, sai đầu file là hỏng cả file.
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const reloaded = await reload(buffer);

    const sheet = reloaded.getWorksheet('Đơn hàng');
    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBe(3); // 1 header + 2 dòng dữ liệu

    expect(sheet!.getRow(1).getCell(1).value).toBe('Mã đơn');
    expect(sheet!.getRow(2).getCell(1).value).toBe('DH-001');
    // Số tiền phải là number, không phải string — nếu thành string thì Excel
    // không tính tổng được.
    expect(sheet!.getRow(2).getCell(11).value).toBe(1234.56);
    expect(sheet!.getRow(3).getCell(11).value).toBe(99);
  });

  it('không có đơn nào thì vẫn ra file hợp lệ chỉ có header', async () => {
    const buffer = await buildOrdersSheet({ rows: [], title: 'Đơn hàng' });

    const reloaded = await reload(buffer);

    expect(reloaded.getWorksheet('Đơn hàng')!.rowCount).toBe(1);
  });
});
