import { toNumber } from '../../common/utils/money.util';
import { Prisma } from '../../generated/prisma/client';

// Explicit, not `items: true` / `payment: true`: `true` means every column of
// the relation, and `toOrderResponse` reads a third of them. The one that
// actually matters is `Payment.paymentData` — a Json blob of the gateway's
// response, read by nothing here and pulled over the wire on every order read.
const orderItemSelect = {
  id: true,
  productId: true,
  productName: true,
  productPrice: true,
  quantity: true,
  subtotal: true,
} satisfies Prisma.OrderItemSelect;

const paymentSelect = {
  status: true,
  paymentMethod: true,
  transactionId: true,
  paidAt: true,
} satisfies Prisma.PaymentSelect;

export const orderInclude = {
  items: { select: orderItemSelect },
  payment: { select: paymentSelect },
} satisfies Prisma.OrderInclude;

export const adminOrderInclude = {
  items: { select: orderItemSelect },
  payment: { select: paymentSelect },
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
