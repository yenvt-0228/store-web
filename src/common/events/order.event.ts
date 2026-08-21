import type { Locale } from '../constants/locale.constant';

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
  locale: Locale;
}

export interface OrderConfirmedEvent {
  email: string;
  name: string;
  orderCode: string;
  locale: Locale;
}

export interface OrderRejectedEvent {
  email: string;
  name: string;
  orderCode: string;
  reason: string;
  locale: Locale;
}
