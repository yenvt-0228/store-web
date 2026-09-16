import type { Locale } from '../constants/locale.constant';

export const ReportEvent = {
  MONTHLY_REVENUE: 'report.monthly-revenue',
} as const;

/** Một dòng trong bảng sản phẩm bán chạy của email báo cáo. */
export interface MonthlyRevenueTopProduct {
  productName: string;
  quantitySold: number;
  revenue: number;
}

/**
 * Báo cáo doanh thu một tháng, gửi cho một admin.
 *
 * Mỗi admin một sự kiện chứ không phải một sự kiện mang danh sách người nhận:
 * ngôn ngữ nằm trên từng người, và một địa chỉ hỏng không được kéo theo cả
 * những người còn lại.
 */
export interface MonthlyRevenueEvent {
  email: string;
  name: string;
  /** Tháng được tổng hợp, 1-12. */
  month: number;
  year: number;
  revenue: number;
  completedOrders: number;
  totalOrders: number;
  averageOrderValue: number;
  topProducts: MonthlyRevenueTopProduct[];
  locale: Locale;
}
