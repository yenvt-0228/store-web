import { INestApplication } from '@nestjs/common';
import { RoleName } from '../src/common/constants/role.constant';
import { ProductStatus } from '../src/generated/prisma/enums';
import {
  SeededUser,
  body,
  createTestApp,
  db,
  http,
  resetDb,
  seedCategory,
  seedProduct,
  seedUser,
} from './test-helpers';

interface ProductPayload {
  id: string;
  name: string;
  price: number;
  quantity: number;
  inStock: boolean;
  status: string;
  isFeatured: boolean;
  category: { id: string; name: string } | null;
}
type ProductListBody = {
  data: ProductPayload[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};
type ProductBody = { product: ProductPayload };

describe('Product (e2e)', () => {
  let app: INestApplication;
  let admin: SeededUser;
  let member: SeededUser;
  let categoryId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(app);
    admin = await seedUser(app, {
      email: 'admin@example.com',
      roles: [RoleName.ADMIN],
    });
    member = await seedUser(app, { email: 'member@example.com' });
    categoryId = (await seedCategory(app, 'Điện thoại')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  /* User */

  it('GET /products không cần đăng nhập', async () => {
    await seedProduct(app, { categoryId, name: 'iPhone' });
    const res = await http(app).get('/products').expect(200);
    expect(body<ProductListBody>(res).meta.total).toBe(1);
  });

  it('GET /products KHÔNG hiện hàng đang ẩn hoặc đã xoá', async () => {
    await seedProduct(app, { categoryId, name: 'Đang bán' });
    await seedProduct(app, {
      categoryId,
      name: 'Đang ẩn',
      status: ProductStatus.INACTIVE,
    });
    await seedProduct(app, {
      categoryId,
      name: 'Đã xoá',
      deletedAt: new Date(),
    });

    const res = await http(app).get('/products').expect(200);
    const { data, meta } = body<ProductListBody>(res);
    expect(meta.total).toBe(1);
    expect(data[0].name).toBe('Đang bán');
  });

  it('GET /products tìm theo từ khoá (tên hoặc mô tả)', async () => {
    await seedProduct(app, { categoryId, name: 'Laptop Dell' });
    await seedProduct(app, { categoryId, name: 'Chuột không dây' });

    const res = await http(app)
      .get('/products')
      .query({ keyword: 'laptop' })
      .expect(200);
    expect(body<ProductListBody>(res).meta.total).toBe(1);
  });

  it('GET /products lọc theo khoảng giá', async () => {
    await seedProduct(app, { categoryId, name: 'Rẻ', price: 50_000 });
    await seedProduct(app, { categoryId, name: 'Vừa', price: 500_000 });
    await seedProduct(app, { categoryId, name: 'Đắt', price: 5_000_000 });

    const res = await http(app)
      .get('/products')
      .query({ minPrice: 100_000, maxPrice: 1_000_000 })
      .expect(200);

    const { data, meta } = body<ProductListBody>(res);
    expect(meta.total).toBe(1);
    expect(data[0].name).toBe('Vừa');
  });

  it('GET /products sắp xếp theo giá tăng dần', async () => {
    await seedProduct(app, { categoryId, name: 'B', price: 300_000 });
    await seedProduct(app, { categoryId, name: 'A', price: 100_000 });

    const res = await http(app)
      .get('/products')
      .query({ sort: 'price_asc' })
      .expect(200);

    expect(body<ProductListBody>(res).data.map((p) => p.price)).toEqual([
      100_000, 300_000,
    ]);
  });

  it('GET /products?sort=gia-tri-la -> 400', async () => {
    await http(app).get('/products').query({ sort: 'lung-tung' }).expect(400);
  });

  it('GET /products/featured chỉ trả hàng nổi bật', async () => {
    await seedProduct(app, { categoryId, name: 'Nổi bật', isFeatured: true });
    await seedProduct(app, { categoryId, name: 'Thường' });

    const res = await http(app).get('/products/featured').expect(200);
    const { data } = body<{ data: ProductPayload[] }>(res);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Nổi bật');
  });

  it('GET /products/:id trả kèm danh mục', async () => {
    const product = await seedProduct(app, { categoryId, name: 'iPad' });

    const res = await http(app).get(`/products/${product.id}`).expect(200);
    expect(body<ProductBody>(res).product.category?.name).toBe('Điện thoại');
  });

  it('GET /products/:id với hàng đang ẩn -> 404', async () => {
    const hidden = await seedProduct(app, {
      categoryId,
      status: ProductStatus.INACTIVE,
    });
    await http(app).get(`/products/${hidden.id}`).expect(404);
  });

  /*  ADMIN  */

  it('POST /admin/products bằng token USER -> 403', async () => {
    await http(app)
      .post('/admin/products')
      .set(auth(member.accessToken))
      .send({ name: 'X', categoryId, price: 1000, quantity: 1 })
      .expect(403);
  });

  it('POST /admin/products -> tạo được', async () => {
    const res = await http(app)
      .post('/admin/products')
      .set(auth(admin.accessToken))
      .send({
        name: 'Bàn phím cơ',
        categoryId,
        price: 1_200_000,
        quantity: 5,
        isFeatured: true,
      })
      .expect(201);

    const { product } = body<ProductBody>(res);
    expect(product.price).toBe(1_200_000);
    expect(product.inStock).toBe(true);
  });

  it('POST /admin/products với categoryId không tồn tại -> 404', async () => {
    await http(app)
      .post('/admin/products')
      .set(auth(admin.accessToken))
      .send({
        name: 'X',
        categoryId: '00000000-0000-4000-8000-000000000000',
        price: 1000,
        quantity: 1,
      })
      .expect(404);
  });

  it('POST /admin/products giá quá 2 chữ số thập phân -> 400', async () => {
    await http(app)
      .post('/admin/products')
      .set(auth(admin.accessToken))
      .send({ name: 'X', categoryId, price: 10.999, quantity: 1 })
      .expect(400);
  });

  it('DELETE /admin/products/:id -> xoá MỀM, dữ liệu vẫn còn trong DB', async () => {
    const product = await seedProduct(app, { categoryId });

    await http(app)
      .delete(`/admin/products/${product.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    const inDb = await db(app).product.findUnique({
      where: { id: product.id },
    });
    expect(inDb).not.toBeNull();
    expect(inDb?.deletedAt).not.toBeNull();

    await http(app).get(`/products/${product.id}`).expect(404);
  });

  it('GET /admin/products thấy CẢ hàng đang ẩn', async () => {
    await seedProduct(app, { categoryId, status: ProductStatus.INACTIVE });

    const res = await http(app)
      .get('/admin/products')
      .set(auth(admin.accessToken))
      .expect(200);

    expect(body<ProductListBody>(res).meta.total).toBe(1);
  });

  it('DELETE /admin/categories/:id khi còn sản phẩm -> 400', async () => {
    await seedProduct(app, { categoryId });

    await http(app)
      .delete(`/admin/categories/${categoryId}`)
      .set(auth(admin.accessToken))
      .expect(400);
  });
});
