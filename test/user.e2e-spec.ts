import { INestApplication } from '@nestjs/common';
import {
  ErrorBody,
  MessageBody,
  SeededUser,
  UserBody,
  body,
  createTestApp,
  db,
  findRefreshToken,
  http,
  resetDb,
  seedRefreshToken,
  seedUser,
} from './test-helpers';

describe('User profile (e2e)', () => {
  let app: INestApplication;
  let me: SeededUser;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(app);
    me = await seedUser(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /users/me -> 200 và KHÔNG lộ password', async () => {
    const res = await http(app)
      .get('/users/me')
      .set(auth(me.accessToken))
      .expect(200);

    const { user } = body<UserBody>(res);
    expect(user.email).toBe(me.email);
    expect(user.roles).toEqual(['USER']);
    expect(user).not.toHaveProperty('password');
  });

  it('GET /users/me không token -> 401', async () => {
    await http(app).get('/users/me').expect(401);
  });

  it('PATCH /users/me -> 200 và lưu vào DB', async () => {
    const res = await http(app)
      .patch('/users/me')
      .set(auth(me.accessToken))
      .send({ name: 'Tên mới', phone: '0912345678', address: 'Hà Nội' })
      .expect(200);

    const { user } = body<UserBody>(res);
    expect(user.name).toBe('Tên mới');
    expect(user.phone).toBe('0912345678');

    const inDb = await db(app).user.findUnique({ where: { id: me.id } });
    expect(inDb?.address).toBe('Hà Nội');
  });

  it('PATCH /users/me số điện thoại sai định dạng -> 400', async () => {
    const res = await http(app)
      .patch('/users/me')
      .set(auth(me.accessToken))
      .send({ phone: 'khong-phai-so' })
      .expect(400);

    expect(body<ErrorBody>(res).errors.body.length).toBeGreaterThan(0);
  });

  it('PATCH /users/me KHÔNG cho tự sửa email/role/trạng thái', async () => {
    const res = await http(app)
      .patch('/users/me')
      .set(auth(me.accessToken))
      .send({
        name: 'Tên mới',
        email: 'hacker@example.com',
        status: 'INACTIVE',
      })
      .expect(200);

    const { user } = body<UserBody>(res);
    expect(user.email).toBe(me.email);
    expect(user.status).toBe('ACTIVE');

    const inDb = await db(app).user.findUnique({ where: { id: me.id } });
    expect(inDb?.email).toBe(me.email);
    expect(inDb?.name).toBe('Tên mới'); // field hợp lệ vẫn được cập nhật
  });

  it('PATCH /users/me/password -> 200, đăng nhập bằng mật khẩu mới', async () => {
    const res = await http(app)
      .patch('/users/me/password')
      .set(auth(me.accessToken))
      .send({
        oldPassword: me.password,
        newPassword: 'matkhaumoi',
        confirmPassword: 'matkhaumoi',
      })
      .expect(200);

    expect(body<MessageBody>(res).message).toBeTruthy();

    await http(app)
      .post('/auth/login')
      .send({ email: me.email, password: 'matkhaumoi' })
      .expect(200);
  });

  it('PATCH /users/me/password đăng xuất mọi thiết bị (thu hồi refresh token)', async () => {
    const session = await seedRefreshToken(app, me.id);

    await http(app)
      .patch('/users/me/password')
      .set(auth(me.accessToken))
      .send({
        oldPassword: me.password,
        newPassword: 'matkhaumoi',
        confirmPassword: 'matkhaumoi',
      })
      .expect(200);

    expect((await findRefreshToken(app, session))?.revokedAt).not.toBeNull();
  });

  it('PATCH /users/me/password sai mật khẩu cũ -> 400', async () => {
    await http(app)
      .patch('/users/me/password')
      .set(auth(me.accessToken))
      .send({
        oldPassword: 'sai-mat-khau',
        newPassword: 'matkhaumoi',
        confirmPassword: 'matkhaumoi',
      })
      .expect(400);
  });

  it('PATCH /users/me/password trùng mật khẩu cũ -> 400', async () => {
    await http(app)
      .patch('/users/me/password')
      .set(auth(me.accessToken))
      .send({
        oldPassword: me.password,
        newPassword: me.password,
        confirmPassword: me.password,
      })
      .expect(400);
  });

  it('PATCH /users/me/password confirmPassword lệch -> 400', async () => {
    await http(app)
      .patch('/users/me/password')
      .set(auth(me.accessToken))
      .send({
        oldPassword: me.password,
        newPassword: 'matkhaumoi',
        confirmPassword: 'lech-hoan-toan',
      })
      .expect(400);
  });
});
