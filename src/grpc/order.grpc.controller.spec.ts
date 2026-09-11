import { OrderService } from '../order/order.service';
import { OrderGrpcController } from './order.grpc.controller';

function orderResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a9f0-1',
    orderCode: 'DH-001',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'COD',
    totalAmount: 1234.5,
    shipping: {
      name: 'Nguyễn Văn A',
      phone: '0900000000',
      address: '1 Đường A',
    },
    items: [
      {
        id: 'item-1',
        productId: 'p-1',
        productName: 'Bàn phím',
        productPrice: 617.25,
        quantity: 2,
        subtotal: 1234.5,
      },
    ],
    payment: null,
    cancelReason: null,
    rejectReason: null,
    createdAt: new Date('2026-09-10T03:00:00.000Z'),
    ...overrides,
  };
}

function build() {
  const orders = {
    findByCode: jest.fn(),
    findAll: jest.fn(),
  };

  return {
    orders,
    controller: new OrderGrpcController(orders as unknown as OrderService),
  };
}

describe('OrderGrpcController', () => {
  describe('GetOrder', () => {
    it('maps the order onto the proto message', async () => {
      const { controller, orders } = build();
      orders.findByCode.mockResolvedValue(orderResponse());

      const result = await controller.getOrder({ orderCode: 'DH-001' });

      expect(orders.findByCode).toHaveBeenCalledWith('DH-001');
      expect(result).toEqual({
        id: 'a9f0-1',
        orderCode: 'DH-001',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'COD',
        // String with two decimals, not the number 1234.5: the column is
        // Decimal(12,2) and a caller parsing "1234.5" has to guess at the cents.
        totalAmount: '1234.50',
        shipping: {
          name: 'Nguyễn Văn A',
          phone: '0900000000',
          address: '1 Đường A',
        },
        items: [
          {
            productId: 'p-1',
            productName: 'Bàn phím',
            productPrice: '617.25',
            quantity: 2,
            subtotal: '1234.50',
          },
        ],
        createdAt: '2026-09-10T03:00:00.000Z',
      });
    });

    it('does not put the payment or the reasons on the wire', async () => {
      // The proto promises fewer fields than the HTTP response on purpose;
      // every field in a contract is a field somebody may come to depend on.
      const { controller, orders } = build();
      orders.findByCode.mockResolvedValue(
        orderResponse({ cancelReason: 'khách đổi ý' }),
      );

      const result = await controller.getOrder({ orderCode: 'DH-001' });

      expect(result).not.toHaveProperty('cancelReason');
      expect(result).not.toHaveProperty('payment');
      expect(result.items[0]).not.toHaveProperty('id');
    });

    it('lets a NotFoundException through for the filter to translate', async () => {
      const { controller, orders } = build();
      orders.findByCode.mockRejectedValue(new Error('order.NOT_FOUND'));

      await expect(
        controller.getOrder({ orderCode: 'nope' }),
      ).rejects.toThrow();
    });
  });

  describe('ListOrders', () => {
    it('falls back to page 1 / limit 10 on proto3 zero values', async () => {
      // proto3 has no null: an unset int32 arrives as 0, and asking Prisma for
      // `take: 0` returns nothing at all.
      const { controller, orders } = build();
      orders.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });

      await controller.listOrders({
        userId: 'u-1',
        status: '',
        page: 0,
        limit: 0,
      });

      expect(orders.findAll).toHaveBeenCalledWith('u-1', {
        page: 1,
        limit: 10,
        skip: 0,
      });
    });

    it('treats an empty status as no filter, not as a status of ""', async () => {
      const { controller, orders } = build();
      orders.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });

      await controller.listOrders({
        userId: 'u-1',
        status: '',
        page: 2,
        limit: 5,
      });

      expect(orders.findAll).toHaveBeenCalledWith('u-1', {
        page: 2,
        limit: 5,
        skip: 5,
      });
    });

    it('passes a status through and reports the unpaged total', async () => {
      const { controller, orders } = build();
      orders.findAll.mockResolvedValue({
        data: [orderResponse()],
        meta: { total: 42, page: 1, limit: 10, totalPages: 5 },
      });

      const result = await controller.listOrders({
        userId: 'u-1',
        status: 'CONFIRMED',
        page: 1,
        limit: 10,
      });

      expect(orders.findAll).toHaveBeenCalledWith('u-1', {
        page: 1,
        limit: 10,
        skip: 0,
        status: 'CONFIRMED',
      });
      expect(result.total).toBe(42);
      expect(result.orders).toHaveLength(1);
    });
  });
});
