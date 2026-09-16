import { OrderStatus } from '../generated/prisma/enums';

/**
 * Trạng thái đơn được tính vào doanh thu.
 *
 * Chỉ COMPLETED — tức là hàng đã tới tay khách. Đơn CONFIRMED hay SHIPPING vẫn
 * có thể bị huỷ hoặc hoàn, nên cộng chúng vào doanh thu là đếm tiền chưa chắc
 * giữ được. Số đơn đang trên đường vẫn nhìn thấy được qua `ordersByStatus` của
 * dashboard, nên không mất thông tin, chỉ là không lẫn vào doanh thu.
 *
 * Cùng một tinh thần với `PURCHASED_STATUSES` bên ReviewService: "đã xong" là
 * COMPLETED, ở mọi chỗ trong hệ thống.
 */
export const REVENUE_STATUSES: OrderStatus[] = [OrderStatus.COMPLETED];

// Tên kiểu enum của Postgres, do `@@map("order_status")` trong schema sinh ra.
// Truy vấn thô phải ép tham số về đúng kiểu này, nếu không Postgres từ chối so
// sánh text với enum — và ép sang text thì mất index trên cột status.
export const ORDER_STATUS_PG_TYPE = 'order_status';

// Trần mặc định cho bảng xếp hạng sản phẩm bán chạy.
export const DEFAULT_TOP_PRODUCTS = 10;
