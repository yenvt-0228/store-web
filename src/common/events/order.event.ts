export const OrderEvent = {
  CREATED: 'order.created',
  CONFIRMED: 'order.confirmed',
  REJECTED: 'order.rejected',
} as const;

export interface OrderCreatedEvent {
  email: string;
  name: string;
  orderCode: string;
  totalAmount: number;
}

export interface OrderConfirmedEvent {
  email: string;
  name: string;
  orderCode: string;
}

export interface OrderRejectedEvent {
  email: string;
  name: string;
  orderCode: string;
  reason: string;
}
