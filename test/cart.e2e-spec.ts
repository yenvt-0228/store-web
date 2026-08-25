import { INestApplication } from '@nestjs/common';
import { ProductStatus } from '../src/generated/prisma/enums';
import { RedisService } from '../src/redis/redis.service';
import {
  CartBody,
  SeededProduct,
  SeededUser,
  body,
  createTestApp,
  db,
  http,
  resetDb,
  seedProduct,
  seedUser,
} from './test-helpers';

describe('Cart (e2e) — giỏ hàng lưu trong Redis', () => {
  let app: INestApplication;
  let me: SeededUser;
  let product: SeededProduct;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const redis = () => app.get(RedisService).client;
  const ttlOf = (userId: string) => redis().ttl(`cart:${userId}`);

  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(app);
    me = await seedUser(app);
    product = await seedProduct(app, { price: 150_000, quantity: 10 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /cart khi chưa có gì -> giỏ rỗng', async () => {
    const res = await http(app)
      .get('/cart')
      .set(auth(me.accessToken))
      .expect(200);

    const { cart } = body<CartBody>(res);
    expect(cart.items).toEqual([]);
    expect(cart.totalAmount).toBe(0);
  });

  it('GET /cart không token -> 401', async () => {
    await http(app).get('/cart').expect(401);
  });

  it('POST /cart/items -> thêm được, tính đúng thành tiền', async () => {
    const res = await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 2 })
      .expect(201);

    const { cart } = body<CartBody>(res);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(2);
    expect(cart.items[0].subtotal).toBe(300_000);
    expect(cart.totalAmount).toBe(300_000);
    expect(cart.items[0].available).toBe(true);
  });

  it('POST /cart/items cùng sản phẩm 2 lần -> CỘNG DỒN số lượng', async () => {
    const add = (quantity: number) =>
      http(app)
        .post('/cart/items')
        .set(auth(me.accessToken))
        .send({ productId: product.id, quantity })
        .expect(201);

    await add(2);
    const res = await add(3);

    const { cart } = body<CartBody>(res);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(5);
  });

  it('POST /cart/items vượt tồn kho -> 400', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 11 })
      .expect(400);
  });

  it('POST /cart/items cộng dồn vượt tồn kho -> 400 (kiểm theo TỔNG)', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 8 })
      .expect(201);

    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 5 })
      .expect(400);
  });

  it('POST /cart/items 10 request song song -> cộng dồn đủ 10, không mất update', async () => {
    const add = () =>
      http(app)
        .post('/cart/items')
        .set(auth(me.accessToken))
        .send({ productId: product.id, quantity: 1 });

    const responses = await Promise.all(Array.from({ length: 10 }, add));
    expect(responses.every((res) => res.status === 201)).toBe(true);

    const res = await http(app)
      .get('/cart')
      .set(auth(me.accessToken))
      .expect(200);

    expect(body<CartBody>(res).cart.items[0].quantity).toBe(10);
  });

  it('POST /cart/items cộng dồn vượt trần 99 -> 400 và giỏ giữ nguyên', async () => {
    const many = await seedProduct(app, { name: 'Hàng nhiều', quantity: 500 });
    const add = (quantity: number) =>
      http(app)
        .post('/cart/items')
        .set(auth(me.accessToken))
        .send({ productId: many.id, quantity });

    await add(60).expect(201);
    await add(60).expect(400);

    const res = await http(app)
      .get('/cart')
      .set(auth(me.accessToken))
      .expect(200);

    const item = body<CartBody>(res).cart.items.find(
      (i) => i.productId === many.id,
    );
    expect(item?.quantity).toBe(60);
  });

  it('POST /cart/items vượt tồn kho -> không để lại rác trong giỏ', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 11 })
      .expect(400);

    const res = await http(app)
      .get('/cart')
      .set(auth(me.accessToken))
      .expect(200);

    expect(body<CartBody>(res).cart.items).toEqual([]);
  });

  it('POST /cart/items sản phẩm không tồn tại -> 404', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({
        productId: '00000000-0000-4000-8000-000000000000',
        quantity: 1,
      })
      .expect(404);
  });

  it('POST /cart/items sản phẩm đang ẩn -> 404', async () => {
    const hidden = await seedProduct(app, { status: ProductStatus.INACTIVE });

    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: hidden.id, quantity: 1 })
      .expect(404);
  });

  it('PATCH /cart/items/:id -> đổi số lượng', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 2 })
      .expect(201);

    const res = await http(app)
      .patch(`/cart/items/${product.id}`)
      .set(auth(me.accessToken))
      .send({ quantity: 7 })
      .expect(200);

    expect(body<CartBody>(res).cart.items[0].quantity).toBe(7);
  });

  it('PATCH /cart/items/:id sản phẩm không có trong giỏ -> 404', async () => {
    await http(app)
      .patch(`/cart/items/${product.id}`)
      .set(auth(me.accessToken))
      .send({ quantity: 1 })
      .expect(404);
  });

  it('DELETE /cart/items/:id -> xoá đúng một món', async () => {
    const other = await seedProduct(app, { name: 'Sản phẩm 2' });
    const add = (id: string) =>
      http(app)
        .post('/cart/items')
        .set(auth(me.accessToken))
        .send({ productId: id, quantity: 1 })
        .expect(201);

    await add(product.id);
    await add(other.id);

    const res = await http(app)
      .delete(`/cart/items/${product.id}`)
      .set(auth(me.accessToken))
      .expect(200);

    const { cart } = body<CartBody>(res);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].productId).toBe(other.id);
  });

  it('DELETE /cart -> xoá sạch giỏ', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 2 })
      .expect(201);

    await http(app).delete('/cart').set(auth(me.accessToken)).expect(200);

    const res = await http(app)
      .get('/cart')
      .set(auth(me.accessToken))
      .expect(200);
    expect(body<CartBody>(res).cart.items).toEqual([]);
  });

  it('GET /cart cũng gia hạn TTL (TTL trượt, không chỉ khi thêm/sửa)', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 1 })
      .expect(201);

    // Giả lập giỏ sắp hết hạn.
    await redis().expire(`cart:${me.id}`, 100);
    expect(await ttlOf(me.id)).toBeLessThanOrEqual(100);

    await http(app).get('/cart').set(auth(me.accessToken)).expect(200);

    expect(await ttlOf(me.id)).toBeGreaterThan(THIRTY_DAYS - 60);
  });

  it('GET /cart khi giỏ rỗng -> không tạo key rác trong Redis', async () => {
    await http(app).get('/cart').set(auth(me.accessToken)).expect(200);

    // -2 = key không tồn tại.
    expect(await ttlOf(me.id)).toBe(-2);
  });

  it('Giỏ hàng tách riêng theo từng user', async () => {
    const other = await seedUser(app, { email: 'khac@example.com' });

    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 3 })
      .expect(201);

    const res = await http(app)
      .get('/cart')
      .set(auth(other.accessToken))
      .expect(200);

    expect(body<CartBody>(res).cart.items).toEqual([]);
  });

  it('Sản phẩm bị ẩn sau khi đã nằm trong giỏ -> đánh dấu không mua được', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 2 })
      .expect(201);

    await db(app).product.update({
      where: { id: product.id },
      data: { status: ProductStatus.INACTIVE },
    });

    const res = await http(app)
      .get('/cart')
      .set(auth(me.accessToken))
      .expect(200);

    const { cart } = body<CartBody>(res);
    expect(cart.items[0].available).toBe(false);
    expect(cart.items[0].reason).toBe('INACTIVE');
    expect(cart.totalAmount).toBe(0);
  });

  it('Tồn kho tụt dưới số trong giỏ -> reason INSUFFICIENT_STOCK', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 6 })
      .expect(201);

    await db(app).product.update({
      where: { id: product.id },
      data: { quantity: 2 },
    });

    const res = await http(app)
      .get('/cart')
      .set(auth(me.accessToken))
      .expect(200);

    const { cart } = body<CartBody>(res);
    expect(cart.items[0].available).toBe(false);
    expect(cart.items[0].reason).toBe('INSUFFICIENT_STOCK');
    expect(cart.items[0].stock).toBe(2);
  });

  it('Sản phẩm bị xoá mềm -> reason DELETED', async () => {
    await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 1 })
      .expect(201);

    await db(app).product.update({
      where: { id: product.id },
      data: { deletedAt: new Date() },
    });

    const res = await http(app)
      .get('/cart')
      .set(auth(me.accessToken))
      .expect(200);

    const { cart } = body<CartBody>(res);
    expect(cart.items[0].available).toBe(false);
    expect(cart.items[0].reason).toBe('DELETED');
  });

  it('Món đặt được -> reason null', async () => {
    const res = await http(app)
      .post('/cart/items')
      .set(auth(me.accessToken))
      .send({ productId: product.id, quantity: 1 })
      .expect(201);

    expect(body<CartBody>(res).cart.items[0].reason).toBeNull();
  });
});
