import { toNumber } from '../../common/utils/money.util';
import { Prisma } from '../../generated/prisma/client';

export const orderInclude = {
  items: true,
  payment: true,
} satisfies Prisma.OrderInclude;

export const adminOrderInclude = {
  items: true,
  payment: true,
  user: { select: { id: true, name: true, email: true, locale: true } },
} satisfies Prisma.OrderInclude;

type OrderPayload = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type AdminOrderPayload = Prisma.OrderGetPayload<{
  include: typeof adminOrderInclude;
}>;

export function toOrderResponse(order: OrderPayload | AdminOrderPayload) {
  const customer = 'user' in order ? order.user : undefined;

  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    totalAmount: toNumber(order.totalAmount),
    shipping: {
      name: order.shippingName,
      phone: order.shippingPhone,
      address: order.shippingAddress,
    },
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      productPrice: toNumber(item.productPrice),
      quantity: item.quantity,
      subtotal: toNumber(item.subtotal),
    })),
    payment: order.payment
      ? {
          status: order.payment.status,
          method: order.payment.paymentMethod,
          transactionId: order.payment.transactionId,
          paidAt: order.payment.paidAt,
        }
      : null,
    cancelReason: order.cancelReason,
    rejectReason: order.rejectReason,
    ...(customer ? { customer } : {}),
    createdAt: order.createdAt,
  };
}
