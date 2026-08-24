import { INestApplication } from '@nestjs/common';
import { ProductStatus } from '../src/generated/prisma/enums';
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
    expect(cart.totalAmount).toBe(0);
  });
});
