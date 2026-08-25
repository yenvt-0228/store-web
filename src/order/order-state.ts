import { OrderStatus } from '../generated/prisma/enums';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
    OrderStatus.CONFIRMED,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPING]: [OrderStatus.COMPLETED],
  // Ba trạng thái kết thúc: không đi đâu được nữa.
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REJECTED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function shouldRestoreStock(status: OrderStatus): boolean {
  return status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED;
}

export function requiresReason(status: OrderStatus): boolean {
  return status === OrderStatus.REJECTED || status === OrderStatus.CANCELLED;
}
