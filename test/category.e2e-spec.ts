import { INestApplication } from '@nestjs/common';
import { RoleName } from '../src/common/constants/role.constant';
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

interface CategoryPayload {
  id: string;
  name: string;
  description: string | null;
}
type CategoryBody = { category: CategoryPayload };
type CategoryListBody = {
  data: CategoryPayload[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('Category (e2e) — CRUD danh mục cho admin', () => {
  let app: INestApplication;
  let admin: SeededUser;
  let member: SeededUser;

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
  });

  afterAll(async () => {
    await app.close();
  });

  /* QUYỀN  */

  it('không token -> 401', async () => {
    await http(app).get('/admin/categories').expect(401);
  });

  it('token USER -> 403 ở mọi endpoint', async () => {
    const category = await seedCategory(app, 'Điện thoại');

    await http(app)
      .get('/admin/categories')
      .set(auth(member.accessToken))
      .expect(403);
    await http(app)
      .post('/admin/categories')
      .set(auth(member.accessToken))
      .send({ name: 'X' })
      .expect(403);
    await http(app)
      .patch(`/admin/categories/${category.id}`)
      .set(auth(member.accessToken))
      .send({ name: 'Y' })
      .expect(403);
    await http(app)
      .delete(`/admin/categories/${category.id}`)
      .set(auth(member.accessToken))
      .expect(403);
  });

  /*  TẠO  */

  it('POST /admin/categories -> tạo được', async () => {
    const res = await http(app)
      .post('/admin/categories')
      .set(auth(admin.accessToken))
      .send({ name: 'Đồ điện tử', description: 'Hàng công nghệ' })
      .expect(201);

    const { category } = body<CategoryBody>(res);
    expect(category.name).toBe('Đồ điện tử');
    expect(category.description).toBe('Hàng công nghệ');
    expect(await db(app).category.count()).toBe(1);
  });

  it('POST /admin/categories không có description -> vẫn tạo được, để null', async () => {
    const res = await http(app)
      .post('/admin/categories')
      .set(auth(admin.accessToken))
      .send({ name: 'Sách' })
      .expect(201);

    expect(body<CategoryBody>(res).category.description).toBeNull();
  });

  it('POST /admin/categories tên trùng -> 409', async () => {
    await seedCategory(app, 'Điện thoại');

    await http(app)
      .post('/admin/categories')
      .set(auth(admin.accessToken))
      .send({ name: 'Điện thoại' })
      .expect(409);
  });

  it('POST /admin/categories tên rỗng -> 400', async () => {
    await http(app)
      .post('/admin/categories')
      .set(auth(admin.accessToken))
      .send({ name: '' })
      .expect(400);
  });

  it('POST /admin/categories tên quá 255 ký tự -> 400', async () => {
    await http(app)
      .post('/admin/categories')
      .set(auth(admin.accessToken))
      .send({ name: 'a'.repeat(256) })
      .expect(400);
  });

  /*  Read  */

  it('GET /admin/categories -> sắp xếp theo tên tăng dần', async () => {
    await seedCategory(app, 'Sách');
    await seedCategory(app, 'Điện thoại');
    await seedCategory(app, 'Áo quần');

    const res = await http(app)
      .get('/admin/categories')
      .set(auth(admin.accessToken))
      .expect(200);

    const { data, meta } = body<CategoryListBody>(res);
    expect(meta.total).toBe(3);
    expect(data.map((c) => c.name)).toEqual(
      [...data.map((c) => c.name)].sort(),
    );
  });

  it('GET /admin/categories phân trang', async () => {
    for (const name of ['A', 'B', 'C']) await seedCategory(app, name);

    const res = await http(app)
      .get('/admin/categories?page=2&limit=2')
      .set(auth(admin.accessToken))
      .expect(200);

    const { data, meta } = body<CategoryListBody>(res);
    expect(data).toHaveLength(1);
    expect(meta).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2 });
  });

  it('GET /admin/categories/:id -> chi tiết', async () => {
    const category = await seedCategory(app, 'Điện thoại');

    const res = await http(app)
      .get(`/admin/categories/${category.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    expect(body<CategoryBody>(res).category.name).toBe('Điện thoại');
  });

  it('GET /admin/categories/:id không tồn tại -> 404', async () => {
    await http(app)
      .get(`/admin/categories/${MISSING_ID}`)
      .set(auth(admin.accessToken))
      .expect(404);
  });

  it('GET /admin/categories/:id không phải UUID -> 400', async () => {
    await http(app)
      .get('/admin/categories/khong-phai-uuid')
      .set(auth(admin.accessToken))
      .expect(400);
  });

  /*  SỬA  */

  it('PATCH /admin/categories/:id -> đổi được tên', async () => {
    const category = await seedCategory(app, 'Điện thoại');

    const res = await http(app)
      .patch(`/admin/categories/${category.id}`)
      .set(auth(admin.accessToken))
      .send({ name: 'Điện thoại di động' })
      .expect(200);

    expect(body<CategoryBody>(res).category.name).toBe('Điện thoại di động');
  });

  it('PATCH giữ NGUYÊN tên của chính nó -> vẫn 200, không báo trùng', async () => {
    const category = await seedCategory(app, 'Điện thoại');

    await http(app)
      .patch(`/admin/categories/${category.id}`)
      .set(auth(admin.accessToken))
      .send({ name: 'Điện thoại', description: 'Mô tả mới' })
      .expect(200);
  });

  it('PATCH sang tên của danh mục KHÁC -> 409', async () => {
    const first = await seedCategory(app, 'Điện thoại');
    await seedCategory(app, 'Sách');

    await http(app)
      .patch(`/admin/categories/${first.id}`)
      .set(auth(admin.accessToken))
      .send({ name: 'Sách' })
      .expect(409);
  });

  it('PATCH /admin/categories/:id không tồn tại -> 404', async () => {
    await http(app)
      .patch(`/admin/categories/${MISSING_ID}`)
      .set(auth(admin.accessToken))
      .send({ name: 'X' })
      .expect(404);
  });

  /*  XOÁ  */

  it('DELETE /admin/categories/:id khi trống -> xoá được', async () => {
    const category = await seedCategory(app, 'Điện thoại');

    await http(app)
      .delete(`/admin/categories/${category.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    expect(await db(app).category.count()).toBe(0);
  });

  it('DELETE /admin/categories/:id khi còn sản phẩm -> 400 và KHÔNG xoá', async () => {
    const category = await seedCategory(app, 'Điện thoại');
    await seedProduct(app, { categoryId: category.id });

    await http(app)
      .delete(`/admin/categories/${category.id}`)
      .set(auth(admin.accessToken))
      .expect(400);

    expect(await db(app).category.count()).toBe(1);
  });

  it('DELETE khi sản phẩm đã bị XOÁ MỀM -> 400, vì khoá ngoại vẫn giữ hàng đó', async () => {
    const category = await seedCategory(app, 'Điện thoại');
    await seedProduct(app, { categoryId: category.id, deletedAt: new Date() });

    await http(app)
      .delete(`/admin/categories/${category.id}`)
      .set(auth(admin.accessToken))
      .expect(400);
  });

  it('DELETE /admin/categories/:id không tồn tại -> 404', async () => {
    await http(app)
      .delete(`/admin/categories/${MISSING_ID}`)
      .set(auth(admin.accessToken))
      .expect(404);
  });
});
