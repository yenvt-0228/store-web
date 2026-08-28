import { INestApplication } from '@nestjs/common';
import { RoleName } from '../src/common/constants/role.constant';
import {
  OrderStatus,
  PaymentMethod,
  ProductStatus,
} from '../src/generated/prisma/enums';
import {
  CapturedMail,
  ErrorBody,
  OrderBody,
  OrderListBody,
  SeededProduct,
  SeededUser,
  body,
  captureMails,
  createTestApp,
  db,
  http,
  resetDb,
  seedProduct,
  seedUser,
  shippingInfo,
  stockOf,
  expectOrderInvariants,
} from './test-helpers';

describe('Order (e2e)', () => {
  let app: INestApplication;
  let me: SeededUser;
  let admin: SeededUser;
  let product: SeededProduct;
  let mails: CapturedMail[];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const addToCart = (quantity: number, productId = product.id) =>
    http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId, quantity })
      .expect(201);

  const placeOrder = (payload: Record<string, unknown> = {}) =>
    http(app)
      .post('/orders')
      .set(auth(me.accessToken))
      .send({ ...shippingInfo, paymentMethod: PaymentMethod.COD, ...payload });

  beforeAll(async () => {
    app = await createTestApp();
    mails = captureMails(app);
  });

  beforeEach(async () => {
    await resetDb(app);
    mails.length = 0;
    me = await seedUser(app);
    admin = await seedUser(app, {
      email: 'admin@example.com',
      roles: [RoleName.ADMIN],
    });
    product = await seedProduct(app, { price: 200_000, quantity: 10 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /orders khi giỏ thiếu hàng -> báo giảm số lượng, không bảo xoá món', async () => {
    await addToCart(6);

    await db(app).product.update({
      where: { id: product.id },
      data: { quantity: 2 },
    });

    const res = await http(app)
      .post('/orders?lang=en')
      .set(auth(me.accessToken))
      .send({ ...shippingInfo, paymentMethod: PaymentMethod.COD })
      .expect(400);

    const [message] = body<ErrorBody>(res).errors.body;
    expect(message).toMatch(/reduce the quantity/i);
    expect(message).not.toMatch(/remove/i);
    expect(await stockOf(app, product.id)).toBe(2);
  });

  it('POST /orders khi giỏ có món không mua được -> 400, KHÔNG tạo đơn thiếu hàng', async () => {
    const other = await seedProduct(app, { name: 'Hàng sắp ẩn', quantity: 5 });
    await addToCart(2);
    await addToCart(1, other.id);

    // Món thứ hai bị ẩn sau khi đã nằm trong giỏ.
    await db(app).product.update({
      where: { id: other.id },
      data: { status: ProductStatus.INACTIVE },
    });

    await placeOrder().expect(400);

    // Không có đơn nào được tạo, kho giữ nguyên.
    const list = await http(app)
      .get('/orders')
      .set(auth(me.accessToken))
      .expect(200);
    expect(body<OrderListBody>(list).data).toHaveLength(0);
    expect(await stockOf(app, product.id)).toBe(10);
  });

  it('POST /orders từ giỏ hàng -> tạo đơn, TRỪ KHO và dọn giỏ', async () => {
    await addToCart(3);

    const res = await placeOrder().expect(201);
    const { order } = body<OrderBody>(res);

    expect(order.orderCode).toMatch(/^ORD-\d{8}-[0-9A-F]{6}$/);
    expect(order.status).toBe(OrderStatus.PENDING);
    expect(order.totalAmount).toBe(600_000);
    expect(order.items).toHaveLength(1);
    // Tên và giá được CHỐT vào đơn, không phải tham chiếu động.
    expect(order.items[0].productName).toBe(product.name);
    expect(order.items[0].productPrice).toBe(200_000);

    expect(await stockOf(app, product.id)).toBe(7);
    await expectOrderInvariants(app, order.id);

    const cart = await http(app).get('/cart').set(auth(me.accessToken));
    expect(body<{ cart: { items: unknown[] } }>(cart).cart.items).toEqual([]);
  });

  it('POST /orders có items (mua ngay) -> KHÔNG đụng tới giỏ hàng', async () => {
    await addToCart(2);

    await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);

    const res = await http(app).get('/cart').set(auth(me.accessToken));
    expect(body<{ cart: { items: unknown[] } }>(res).cart.items).toHaveLength(
      1,
    );
    expect(await stockOf(app, product.id)).toBe(9); // chỉ trừ 1 của mua ngay
  });

  it('POST /orders giỏ rỗng -> 400', async () => {
    await placeOrder().expect(400);
  });

  it('POST /orders vượt tồn kho -> 400 và KHÔNG trừ kho', async () => {
    await placeOrder({
      items: [{ productId: product.id, quantity: 50 }],
    }).expect(400);

    expect(await stockOf(app, product.id)).toBe(10);
  });

  it('POST /orders nhiều dòng cùng sản phẩm -> gộp lại, trừ kho đúng một lần', async () => {
    const res = await placeOrder({
      items: [
        { productId: product.id, quantity: 2 },
        { productId: product.id, quantity: 3 },
      ],
    }).expect(201);

    const { order } = body<OrderBody>(res);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(5);
    expect(await stockOf(app, product.id)).toBe(5);
    await expectOrderInvariants(app, order.id);
  });

  it('POST /orders gửi mail xác nhận đã nhận đơn', async () => {
    await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);

    expect(mails.map((m) => m.event)).toContain('order.created');
    expect(mails.find((m) => m.event === 'order.created')?.locale).toBe('vi');
  });

  it('POST /orders của người dùng chọn tiếng Anh -> event mang locale en', async () => {
    const englishUser = await seedUser(app, {
      email: 'en@example.com',
      locale: 'en',
    });

    await http(app)
      .post('/orders')
      .set(auth(englishUser.accessToken))
      .send({
        ...shippingInfo,
        paymentMethod: PaymentMethod.COD,
        items: [{ productId: product.id, quantity: 1 }],
      })
      .expect(201);
    expect(mails.find((m) => m.event === 'order.created')?.locale).toBe('en');
  });

  it('POST /orders số điện thoại sai -> 400', async () => {
    await placeOrder({
      shippingPhone: 'khong-phai-so',
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(400);
  });

  it('GET /orders chỉ trả đơn CỦA MÌNH', async () => {
    const other = await seedUser(app, { email: 'khac@example.com' });
    await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);

    const mine = await http(app)
      .get('/orders')
      .set(auth(me.accessToken))
      .expect(200);
    expect(body<OrderListBody>(mine).meta.total).toBe(1);

    const theirs = await http(app)
      .get('/orders')
      .set(auth(other.accessToken))
      .expect(200);
    expect(body<OrderListBody>(theirs).meta.total).toBe(0);
  });

  it('GET /orders/:id của người khác -> 403', async () => {
    const other = await seedUser(app, { email: 'khac@example.com' });
    const res = await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);
    const { order } = body<OrderBody>(res);

    await http(app)
      .get(`/orders/${order.id}`)
      .set(auth(other.accessToken))
      .expect(403);
  });

  it('PATCH /orders/:id/cancel khi chờ xác nhận -> huỷ được và HOÀN KHO', async () => {
    const created = await placeOrder({
      items: [{ productId: product.id, quantity: 4 }],
    }).expect(201);
    const { order } = body<OrderBody>(created);
    expect(await stockOf(app, product.id)).toBe(6);

    const res = await http(app)
      .patch(`/orders/${order.id}/cancel`)
      .set(auth(me.accessToken))
      .send({ reason: 'Đặt nhầm' })
      .expect(200);

    expect(body<OrderBody>(res).order.status).toBe(OrderStatus.CANCELLED);
    expect(body<OrderBody>(res).order.cancelReason).toBe('Đặt nhầm');
    expect(await stockOf(app, product.id)).toBe(10);
    await expectOrderInvariants(app, order.id);
  });

  it('PATCH /orders/:id/cancel khi admin đã xác nhận -> 400', async () => {
    const created = await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);
    const { order } = body<OrderBody>(created);

    await db(app).order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CONFIRMED },
    });

    await http(app)
      .patch(`/orders/${order.id}/cancel`)
      .set(auth(me.accessToken))
      .send({})
      .expect(400);
  });

  it('GET /admin/orders bằng token USER -> 403', async () => {
    await http(app).get('/admin/orders').set(auth(me.accessToken)).expect(403);
  });

  it('GET /admin/orders tìm theo mã đơn', async () => {
    const created = await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);
    const { order } = body<OrderBody>(created);

    const res = await http(app)
      .get('/admin/orders')
      .query({ keyword: order.orderCode })
      .set(auth(admin.accessToken))
      .expect(200);

    expect(body<OrderListBody>(res).meta.total).toBe(1);
  });

  it('PATCH /admin/orders/:id/status xác nhận -> CONFIRMED + gửi mail', async () => {
    const created = await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);
    const { order } = body<OrderBody>(created);
    mails.length = 0;

    const res = await http(app)
      .patch(`/admin/orders/${order.id}/status`)
      .set(auth(admin.accessToken))
      .send({ status: OrderStatus.CONFIRMED })
      .expect(200);

    expect(body<OrderBody>(res).order.status).toBe(OrderStatus.CONFIRMED);
    expect(mails.map((m) => m.event)).toContain('order.confirmed');
  });

  it('PATCH /admin/orders/:id/status từ chối mà THIẾU lý do -> 400', async () => {
    const created = await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);
    const { order } = body<OrderBody>(created);

    await http(app)
      .patch(`/admin/orders/${order.id}/status`)
      .set(auth(admin.accessToken))
      .send({ status: OrderStatus.REJECTED })
      .expect(400);
  });

  it('PATCH /admin/orders/:id/status từ chối kèm lý do -> HOÀN KHO + gửi mail', async () => {
    const created = await placeOrder({
      items: [{ productId: product.id, quantity: 3 }],
    }).expect(201);
    const { order } = body<OrderBody>(created);
    mails.length = 0;

    const res = await http(app)
      .patch(`/admin/orders/${order.id}/status`)
      .set(auth(admin.accessToken))
      .send({ status: OrderStatus.REJECTED, reason: 'Hết hàng tại kho' })
      .expect(200);

    expect(body<OrderBody>(res).order.rejectReason).toBe('Hết hàng tại kho');
    expect(await stockOf(app, product.id)).toBe(10);
    expect(mails.map((m) => m.event)).toContain('order.rejected');
  });

  it('PATCH /admin/orders/:id/status bước chuyển không hợp lệ -> 400', async () => {
    const created = await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);
    const { order } = body<OrderBody>(created);

    await http(app)
      .patch(`/admin/orders/${order.id}/status`)
      .set(auth(admin.accessToken))
      .send({ status: OrderStatus.COMPLETED })
      .expect(400);
  });

  it('Giao xong đơn COD -> tự đánh dấu đã thanh toán', async () => {
    const created = await placeOrder({
      items: [{ productId: product.id, quantity: 1 }],
    }).expect(201);
    const { order } = body<OrderBody>(created);

    const step = (status: OrderStatus) =>
      http(app)
        .patch(`/admin/orders/${order.id}/status`)
        .set(auth(admin.accessToken))
        .send({ status })
        .expect(200);

    await step(OrderStatus.CONFIRMED);
    await step(OrderStatus.SHIPPING);
    const res = await step(OrderStatus.COMPLETED);

    expect(body<OrderBody>(res).order.paymentStatus).toBe('PAID');
  });
});
