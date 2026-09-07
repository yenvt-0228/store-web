import { INestApplication } from '@nestjs/common';
import { RoleName } from '../src/common/constants/role.constant';
import { UserStatus } from '../src/generated/prisma/enums';
import {
  SeededUser,
  UserBody,
  UserListBody,
  body,
  createTestApp,
  db,
  findRefreshToken,
  http,
  resetDb,
  seedRefreshToken,
  seedUser,
  seedUsers,
} from './test-helpers';

describe('Admin user management (e2e)', () => {
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
    member = await seedUser(app, {
      email: 'member@example.com',
      name: 'Thành viên',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PATCH /admin/users/:id', () => {
    it('admin sửa được thông tin cơ bản của user', async () => {
      const res = await http(app)
        .patch(`/admin/users/${member.id}`)
        .set(auth(admin.accessToken))
        .send({ name: 'Tên mới', phone: '0912345678', address: 'Hà Nội' })
        .expect(200);

      const { user } = body<UserBody>(res);
      expect(user.name).toBe('Tên mới');
      expect(user.phone).toBe('0912345678');
      expect(user.address).toBe('Hà Nội');
    });

    it('không đổi được email và mật khẩu qua endpoint này', async () => {
      await http(app)
        .patch(`/admin/users/${member.id}`)
        .set(auth(admin.accessToken))
        .send({
          name: 'Tên mới',
          email: 'chiem-doat@example.com',
          password: 'hacked123',
        })
        .expect(200);

      const row = await db(app).user.findUnique({ where: { id: member.id } });
      expect(row?.email).toBe('member@example.com');

      // mật khẩu cũ vẫn đăng nhập được -> password trong body đã bị bỏ qua
      await http(app)
        .post('/auth/login')
        .send({ email: member.email, password: member.password })
        .expect(200);
    });

    it('user thường gọi vào -> 403', async () => {
      await http(app)
        .patch(`/admin/users/${admin.id}`)
        .set(auth(member.accessToken))
        .send({ name: 'Đổi trộm' })
        .expect(403);
    });

    it('id không tồn tại -> 404', async () => {
      await http(app)
        .patch('/admin/users/00000000-0000-4000-8000-000000000000')
        .set(auth(admin.accessToken))
        .send({ name: 'Ai đó' })
        .expect(404);
    });
  });

  it('GET /admin/users bằng token USER -> 403', async () => {
    await http(app)
      .get('/admin/users')
      .set(auth(member.accessToken))
      .expect(403);
  });

  it('GET /admin/users không token -> 401', async () => {
    await http(app).get('/admin/users').expect(401);
  });

  it('GET /admin/users bằng token ADMIN -> 200', async () => {
    const res = await http(app)
      .get('/admin/users')
      .set(auth(admin.accessToken))
      .expect(200);

    const { data, meta } = body<UserListBody>(res);
    expect(meta.total).toBe(2);
    expect(data.every((u) => !('password' in u))).toBe(true);
  });

  it('GET /admin/users phân trang theo page/limit', async () => {
    await seedUsers(app, 8);

    const res = await http(app)
      .get('/admin/users')
      .query({ page: 2, limit: 5 })
      .set(auth(admin.accessToken))
      .expect(200);

    const { data, meta } = body<UserListBody>(res);
    expect(meta.total).toBe(10);
    expect(meta.page).toBe(2);
    expect(meta.totalPages).toBe(2);
    expect(data).toHaveLength(5);
  });

  it('GET /admin/users tìm theo keyword (tên hoặc email, không phân biệt hoa thường)', async () => {
    const res = await http(app)
      .get('/admin/users')
      .query({ keyword: 'THÀNH VIÊN' })
      .set(auth(admin.accessToken))
      .expect(200);

    const { data, meta } = body<UserListBody>(res);
    expect(meta.total).toBe(1);
    expect(data[0].email).toBe(member.email);
  });

  it('GET /admin/users lọc theo status', async () => {
    await seedUser(app, {
      email: 'locked@example.com',
      status: UserStatus.INACTIVE,
    });

    const res = await http(app)
      .get('/admin/users')
      .query({ status: UserStatus.INACTIVE })
      .set(auth(admin.accessToken))
      .expect(200);

    const { data, meta } = body<UserListBody>(res);
    expect(meta.total).toBe(1);
    expect(data[0].email).toBe('locked@example.com');
  });

  it('GET /admin/users status không hợp lệ -> 400', async () => {
    await http(app)
      .get('/admin/users')
      .query({ status: 'KHONG_TON_TAI' })
      .set(auth(admin.accessToken))
      .expect(400);
  });

  it('GET /admin/users/:id -> 200', async () => {
    const res = await http(app)
      .get(`/admin/users/${member.id}`)
      .set(auth(admin.accessToken))
      .expect(200);

    expect(body<UserBody>(res).user.email).toBe(member.email);
  });

  it('GET /admin/users/:id không tồn tại -> 404', async () => {
    await http(app)
      .get('/admin/users/00000000-0000-4000-8000-000000000000')
      .set(auth(admin.accessToken))
      .expect(404);
  });

  it('GET /admin/users/:id id không phải UUID -> 400', async () => {
    await http(app)
      .get('/admin/users/khong-phai-uuid')
      .set(auth(admin.accessToken))
      .expect(400);
  });

  it('PATCH /admin/users/:id/status khóa user -> thu hồi phiên đăng nhập', async () => {
    const session = await seedRefreshToken(app, member.id);

    const res = await http(app)
      .patch(`/admin/users/${member.id}/status`)
      .set(auth(admin.accessToken))
      .send({ status: UserStatus.INACTIVE })
      .expect(200);

    expect(body<UserBody>(res).user.status).toBe(UserStatus.INACTIVE);
    expect((await findRefreshToken(app, session))?.revokedAt).not.toBeNull();
  });

  it('User bị khóa thì access token cũ cũng hết tác dụng ngay', async () => {
    await http(app)
      .patch(`/admin/users/${member.id}/status`)
      .set(auth(admin.accessToken))
      .send({ status: UserStatus.INACTIVE })
      .expect(200);

    await http(app).get('/users/me').set(auth(member.accessToken)).expect(403);
  });

  it('PATCH /admin/users/:id/status mở khóa lại -> đăng nhập được', async () => {
    await db(app).user.update({
      where: { id: member.id },
      data: { status: UserStatus.INACTIVE },
    });

    await http(app)
      .patch(`/admin/users/${member.id}/status`)
      .set(auth(admin.accessToken))
      .send({ status: UserStatus.ACTIVE })
      .expect(200);

    await http(app)
      .post('/auth/login')
      .send({ email: member.email, password: member.password })
      .expect(200);
  });

  it('PATCH /admin/users/:id/status admin tự khóa mình -> 400', async () => {
    await http(app)
      .patch(`/admin/users/${admin.id}/status`)
      .set(auth(admin.accessToken))
      .send({ status: UserStatus.INACTIVE })
      .expect(400);
  });

  it('PATCH /admin/users/:id/status bằng token USER -> 403', async () => {
    await http(app)
      .patch(`/admin/users/${admin.id}/status`)
      .set(auth(member.accessToken))
      .send({ status: UserStatus.INACTIVE })
      .expect(403);
  });
});
