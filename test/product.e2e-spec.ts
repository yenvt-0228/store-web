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
  seedProductImage,
  seedUser,
  expectExactlyOnePrimaryImage,
  activeImagesOf,
} from './test-helpers';

interface ProductImagePayload {
  id: string;
  imageUrl: string;
  sortOrder: number;
  isPrimary: boolean;
}
interface ProductPayload {
  id: string;
  name: string;
  price: number;
  quantity: number;
  inStock: boolean;
  status: string;
  isFeatured: boolean;
  category: { id: string; name: string } | null;
  images: ProductImagePayload[];
  primaryImage: string | null;
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

  /* Khách */

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

  /*  ẢNH SẢN PHẨM  */

  const img = (n: number) => `https://cdn.example.com/${n}.jpg`;

  const addImages = (productId: string, images: Record<string, unknown>[]) =>
    http(app)
      .post(`/admin/products/${productId}/images`)
      .set(auth(admin.accessToken))
      .send({ images });

  it('POST /admin/products kèm ảnh -> ảnh ĐẦU TIÊN tự thành ảnh chính', async () => {
    const res = await http(app)
      .post('/admin/products')
      .set(auth(admin.accessToken))
      .send({
        name: 'Máy ảnh',
        categoryId,
        price: 5_000_000,
        quantity: 2,
        images: [{ imageUrl: img(1) }, { imageUrl: img(2) }],
      })
      .expect(201);

    const { product } = body<ProductBody>(res);
    expect(product.images).toHaveLength(2);
    expect(product.primaryImage).toBe(img(1));
    expect(product.images[0].isPrimary).toBe(true);
    expect(product.images.map((i) => i.sortOrder)).toEqual([0, 1]);
    await expectExactlyOnePrimaryImage(app, product.id);
  });

  it('POST /admin/products chỉ định isPrimary -> tôn trọng lựa chọn đó', async () => {
    const res = await http(app)
      .post('/admin/products')
      .set(auth(admin.accessToken))
      .send({
        name: 'Máy ảnh',
        categoryId,
        price: 1000,
        quantity: 1,
        images: [{ imageUrl: img(1) }, { imageUrl: img(2), isPrimary: true }],
      })
      .expect(201);

    expect(body<ProductBody>(res).product.primaryImage).toBe(img(2));
  });

  it('POST /admin/products URL ảnh không hợp lệ -> 400', async () => {
    await http(app)
      .post('/admin/products')
      .set(auth(admin.accessToken))
      .send({
        name: 'X',
        categoryId,
        price: 1000,
        quantity: 1,
        images: [{ imageUrl: 'javascript:alert(1)' }],
      })
      .expect(400);
  });

  it('POST /admin/products URL ảnh trỏ host nội bộ không TLD -> vẫn nhận', async () => {
    const res = await http(app)
      .post('/admin/products')
      .set(auth(admin.accessToken))
      .send({
        name: 'X',
        categoryId,
        price: 1000,
        quantity: 1,
        images: [{ imageUrl: 'http://minio:9000/products/a.png' }],
      })
      .expect(201);

    expect(body<ProductBody>(res).product.primaryImage).toBe(
      'http://minio:9000/products/a.png',
    );
  });

  it('GET /products/:id trả ảnh, ảnh chính đứng đầu', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, { imageUrl: img(1), sortOrder: 0 });
    await seedProductImage(app, product.id, {
      imageUrl: img(2),
      sortOrder: 1,
      isPrimary: true,
    });

    const res = await http(app).get(`/products/${product.id}`).expect(200);

    const { product: found } = body<ProductBody>(res);
    expect(found.images[0].imageUrl).toBe(img(2));
    expect(found.primaryImage).toBe(img(2));
  });

  it('POST :id/images -> thêm được, KHÔNG giành cờ chính của ảnh cũ', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, {
      imageUrl: img(1),
      isPrimary: true,
    });

    const res = await addImages(product.id, [{ imageUrl: img(2) }]).expect(201);

    const { product: updated } = body<ProductBody>(res);
    expect(updated.images).toHaveLength(2);
    expect(updated.primaryImage).toBe(img(1));
    await expectExactlyOnePrimaryImage(app, product.id);
  });

  it('POST :id/images xin làm ảnh chính -> hoán cờ, vẫn chỉ MỘT ảnh chính', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, {
      imageUrl: img(1),
      isPrimary: true,
    });

    const res = await addImages(product.id, [
      { imageUrl: img(2), isPrimary: true },
    ]).expect(201);

    expect(body<ProductBody>(res).product.primaryImage).toBe(img(2));
    await expectExactlyOnePrimaryImage(app, product.id);
  });

  it('POST :id/images vượt 10 ảnh -> 400', async () => {
    const product = await seedProduct(app, { categoryId });
    for (let i = 0; i < 9; i++) {
      await seedProductImage(app, product.id, {
        imageUrl: img(i),
        sortOrder: i,
      });
    }

    await addImages(product.id, [
      { imageUrl: img(98) },
      { imageUrl: img(99) },
    ]).expect(400);
  });

  it('POST :id/images mảng rỗng -> 400', async () => {
    const product = await seedProduct(app, { categoryId });
    await addImages(product.id, []).expect(400);
  });

  it('PATCH :id/images/:imageId đặt làm ảnh chính -> hoán cờ ảnh cũ', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, {
      imageUrl: img(1),
      isPrimary: true,
    });
    const second = await seedProductImage(app, product.id, {
      imageUrl: img(2),
      sortOrder: 1,
    });

    const res = await http(app)
      .patch(`/admin/products/${product.id}/images/${second.id}`)
      .set(auth(admin.accessToken))
      .send({ isPrimary: true })
      .expect(200);

    expect(body<ProductBody>(res).product.primaryImage).toBe(img(2));
    await expectExactlyOnePrimaryImage(app, product.id);
  });

  it('PATCH ảnh của sản phẩm KHÁC -> 404', async () => {
    const mine = await seedProduct(app, { categoryId, name: 'A' });
    const other = await seedProduct(app, { categoryId, name: 'B' });
    const image = await seedProductImage(app, other.id);

    await http(app)
      .patch(`/admin/products/${mine.id}/images/${image.id}`)
      .set(auth(admin.accessToken))
      .send({ sortOrder: 5 })
      .expect(404);
  });

  it('DELETE ảnh chính -> đề bạt ảnh còn lại làm ảnh chính', async () => {
    const product = await seedProduct(app, { categoryId });
    const primary = await seedProductImage(app, product.id, {
      imageUrl: img(1),
      isPrimary: true,
    });
    await seedProductImage(app, product.id, { imageUrl: img(2), sortOrder: 1 });

    await http(app)
      .delete(`/admin/products/${product.id}/images/${primary.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    await expectExactlyOnePrimaryImage(app, product.id);
    const res = await http(app).get(`/products/${product.id}`).expect(200);
    expect(body<ProductBody>(res).product.primaryImage).toBe(img(2));
  });

  it('DELETE ảnh cuối cùng -> sản phẩm không còn ảnh nào, không lỗi', async () => {
    const product = await seedProduct(app, { categoryId });
    const only = await seedProductImage(app, product.id, { isPrimary: true });

    await http(app)
      .delete(`/admin/products/${product.id}/images/${only.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    const res = await http(app).get(`/products/${product.id}`).expect(200);
    expect(body<ProductBody>(res).product.images).toEqual([]);
    expect(body<ProductBody>(res).product.primaryImage).toBeNull();
  });

  it('DELETE ảnh -> XOÁ MỀM, hàng vẫn còn trong DB để khôi phục', async () => {
    const product = await seedProduct(app, { categoryId });
    const image = await seedProductImage(app, product.id, { isPrimary: true });

    await http(app)
      .delete(`/admin/products/${product.id}/images/${image.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    // Biến khỏi API...
    expect(await activeImagesOf(app, product.id)).toHaveLength(0);
    // ...nhưng hàng vẫn còn, ImageCleanupService mới dọn hẳn sau 30 ngày.
    const row = await db(app).image.findUniqueOrThrow({
      where: { id: image.id },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isPrimary).toBe(false);
  });

  it('ảnh đã xoá mềm KHÔNG chặn ảnh chính mới, và không chiếm suất trong 10 ảnh', async () => {
    const product = await seedProduct(app, { categoryId });
    for (let i = 0; i < 10; i++) {
      await seedProductImage(app, product.id, {
        imageUrl: img(i),
        sortOrder: i,
        deletedAt: new Date(),
      });
    }

    const res = await addImages(product.id, [
      { imageUrl: img(99), isPrimary: true },
    ]).expect(201);

    expect(body<ProductBody>(res).product.images).toHaveLength(1);
    expect(body<ProductBody>(res).product.primaryImage).toBe(img(99));
    await expectExactlyOnePrimaryImage(app, product.id);
  });

  it('DELETE /admin/products/:id -> xoá mềm sản phẩm VÀ xoá mềm ảnh của nó', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, { isPrimary: true });
    await seedProductImage(app, product.id, { sortOrder: 1 });

    await http(app)
      .delete(`/admin/products/${product.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    expect(await activeImagesOf(app, product.id)).toHaveLength(0);
    expect(await db(app).image.count({ where: { entityId: product.id } })).toBe(
      2,
    );
  });

  it('xoá CỨNG sản phẩm -> ảnh KHÔNG bị xoá theo (không có khoá ngoại)', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id);

    await db(app).product.delete({ where: { id: product.id } });
    expect(await db(app).image.count({ where: { entityId: product.id } })).toBe(
      1,
    );
  });

  it('PATCH /admin/products KHÔNG ghi đè danh sách ảnh', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, {
      imageUrl: img(1),
      isPrimary: true,
    });

    await http(app)
      .patch(`/admin/products/${product.id}`)
      .set(auth(admin.accessToken))
      .send({ name: 'Tên mới', images: [] })
      .expect(200);

    const res = await http(app).get(`/products/${product.id}`).expect(200);
    expect(body<ProductBody>(res).product.images).toHaveLength(1);
  });

  it('POST :id/images bằng token USER -> 403', async () => {
    const product = await seedProduct(app, { categoryId });

    await http(app)
      .post(`/admin/products/${product.id}/images`)
      .set(auth(member.accessToken))
      .send({ images: [{ imageUrl: img(1) }] })
      .expect(403);
  });
});
