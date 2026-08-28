import { INestApplication } from '@nestjs/common';
import { OrderStatus, PaymentMethod } from '../src/generated/prisma/enums';
import {
  OrderBody,
  SeededProduct,
  SeededUser,
  body,
  createTestApp,
  db,
  http,
  resetDb,
  seedProduct,
  seedUser,
  signCallback,
  shippingInfo,
  expectOrderInvariants,
} from './test-helpers';

interface PaymentBody {
  payment: {
    id: string;
    method: string;
    transactionId: string | null;
    amount: number;
    status: string;
    paidAt: string | null;
  };
  paymentUrl: string | null;
  message: string;
}

interface PaymentStatusBody {
  orderCode: string;
  orderStatus: string;
  paymentStatus: string;
  totalAmount: number;
  payment: { status: string; transactionId: string | null } | null;
}

describe('Payment (e2e) — COD và cổng giả lập', () => {
  let app: INestApplication;
  let me: SeededUser;
  let product: SeededProduct;
  let orderId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const createOrder = async () => {
    const res = await http(app)
      .post('/orders')
      .set(auth(me.accessToken))
      .send({
        ...shippingInfo,
        paymentMethod: PaymentMethod.COD,
        items: [{ productId: product.id, quantity: 2 }],
      })
      .expect(201);
    return body<OrderBody>(res).order;
  };

  const pay = (method: PaymentMethod) =>
    http(app)
      .post('/payments')
      .set(auth(me.accessToken))
      .send({ orderId, paymentMethod: method });

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(app);
    me = await seedUser(app);
    product = await seedProduct(app, { price: 250_000, quantity: 10 });
    orderId = (await createOrder()).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /payments với COD -> ghi nhận, chưa thu tiền, không có link', async () => {
    const res = await pay(PaymentMethod.COD).expect(201);

    const { payment, paymentUrl } = body<PaymentBody>(res);
    expect(payment.status).toBe('PENDING');
    expect(payment.amount).toBe(500_000);
    expect(payment.transactionId).toBeNull();
    expect(paymentUrl).toBeNull();
  });

  it('POST /payments với ONLINE -> có transactionId và link tới cổng', async () => {
    const res = await pay(PaymentMethod.ONLINE).expect(201);

    const { payment, paymentUrl } = body<PaymentBody>(res);
    expect(payment.status).toBe('PENDING');
    expect(payment.transactionId).toMatch(/^MOCK-[0-9A-F]{16}$/);
    expect(paymentUrl).toContain(payment.transactionId as string);
  });

  it('Cổng báo THÀNH CÔNG -> đơn chuyển sang đã thanh toán', async () => {
    const created = await pay(PaymentMethod.ONLINE).expect(201);
    const { payment } = body<PaymentBody>(created);

    const res = await http(app)
      .post('/payments/mock-callback')
      .send({
        transactionId: payment.transactionId,
        success: true,
        signature: signCallback(payment.transactionId!, true),
      })
      .expect(200);

    expect(body<PaymentBody>(res).payment.status).toBe('PAID');
    expect(body<PaymentBody>(res).payment.paidAt).not.toBeNull();

    const status = await http(app)
      .get(`/payments/${orderId}`)
      .set(auth(me.accessToken))
      .expect(200);
    expect(body<PaymentStatusBody>(status).paymentStatus).toBe('PAID');
    await expectOrderInvariants(app, orderId);
  });

  it('Cổng báo THẤT BẠI -> đơn vẫn chưa thanh toán', async () => {
    const created = await pay(PaymentMethod.ONLINE).expect(201);
    const { payment } = body<PaymentBody>(created);

    const res = await http(app)
      .post('/payments/mock-callback')
      .send({
        transactionId: payment.transactionId,
        success: false,
        signature: signCallback(payment.transactionId!, false),
      })
      .expect(200);

    expect(body<PaymentBody>(res).payment.status).toBe('FAILED');

    const status = await http(app)
      .get(`/payments/${orderId}`)
      .set(auth(me.accessToken))
      .expect(200);
    expect(body<PaymentStatusBody>(status).paymentStatus).toBe('UNPAID');
    await expectOrderInvariants(app, orderId);
  });

  it('Cổng gọi lại lần hai -> KHÔNG xử lý lại (idempotent)', async () => {
    const created = await pay(PaymentMethod.ONLINE).expect(201);
    const { payment } = body<PaymentBody>(created);

    const callback = (success: boolean) =>
      http(app)
        .post('/payments/mock-callback')
        .send({
          transactionId: payment.transactionId,
          success,
          signature: signCallback(payment.transactionId!, success),
        })
        .expect(200);

    await callback(true);
    const res = await callback(false);

    expect(body<PaymentBody>(res).payment.status).toBe('PAID');
    await expectOrderInvariants(app, orderId);
  });

  it('Callback với transactionId lạ -> 404', async () => {
    await http(app)
      .post('/payments/mock-callback')
      .send({
        transactionId: 'MOCK-KHONGCOTHAT',
        success: true,
        signature: signCallback('MOCK-KHONGCOTHAT', true),
      })
      .expect(404);
  });

  it('Callback sai chữ ký -> 401 và KHÔNG đổi trạng thái', async () => {
    const created = await pay(PaymentMethod.ONLINE).expect(201);
    const { payment } = body<PaymentBody>(created);

    await http(app)
      .post('/payments/mock-callback')
      .send({
        transactionId: payment.transactionId,
        success: true,
        signature: 'chu-ky-gia',
      })
      .expect(401);

    const status = await http(app)
      .get(`/payments/${orderId}`)
      .set(auth(me.accessToken))
      .expect(200);
    expect(body<PaymentStatusBody>(status).paymentStatus).toBe('UNPAID');
  });

  it('Chữ ký ký cho success=false không dùng lại được cho success=true', async () => {
    const created = await pay(PaymentMethod.ONLINE).expect(201);
    const { payment } = body<PaymentBody>(created);

    await http(app)
      .post('/payments/mock-callback')
      .send({
        transactionId: payment.transactionId,
        success: true,
        signature: signCallback(payment.transactionId!, false),
      })
      .expect(401);
  });

  it('Callback thiếu chữ ký -> 400', async () => {
    const created = await pay(PaymentMethod.ONLINE).expect(201);
    const { payment } = body<PaymentBody>(created);

    await http(app)
      .post('/payments/mock-callback')
      .send({ transactionId: payment.transactionId, success: true })
      .expect(400);
  });

  it('Thanh toán hai lần -> 409', async () => {
    const created = await pay(PaymentMethod.ONLINE).expect(201);
    const { payment } = body<PaymentBody>(created);

    await http(app)
      .post('/payments/mock-callback')
      .send({
        transactionId: payment.transactionId,
        success: true,
        signature: signCallback(payment.transactionId!, true),
      })
      .expect(200);

    await pay(PaymentMethod.ONLINE).expect(409);
  });

  it('Thanh toán đơn đã huỷ -> 400', async () => {
    await db(app).order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });

    await pay(PaymentMethod.COD).expect(400);
  });

  it('Thanh toán đơn của người khác -> 403', async () => {
    const other = await seedUser(app, { email: 'khac@example.com' });

    await http(app)
      .post('/payments')
      .set(auth(other.accessToken))
      .send({ orderId, paymentMethod: PaymentMethod.COD })
      .expect(403);
  });

  it('GET /payments/:orderId không token -> 401', async () => {
    await http(app).get(`/payments/${orderId}`).expect(401);
  });
});
