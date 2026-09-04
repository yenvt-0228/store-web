import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { GoogleProfile } from '../src/auth/google-auth.service';
import { RoleName } from '../src/common/constants/role.constant';
import { UserStatus } from '../src/generated/prisma/enums';
import {
  ErrorBody,
  LoginBody,
  body,
  createTestApp,
  db,
  http,
  resetDb,
  seedUser,
} from './test-helpers';

describe('Google login (e2e)', () => {
  let app: INestApplication;

  const profile: GoogleProfile = {
    googleId: '110000000000000000001',
    email: 'gina@example.com',
    name: 'Gina Google',
    avatar: 'https://lh3.googleusercontent.com/a/gina',
  };

  // Test không gọi ra Google: mỗi case tự quyết định verifyIdToken trả gì.
  let verify: (idToken: string) => Promise<GoogleProfile>;

  const login = (idToken = 'fake-id-token') =>
    http(app).post('/auth/google').send({ idToken });

  beforeAll(async () => {
    app = await createTestApp({
      google: { verifyIdToken: (idToken: string) => verify(idToken) },
    });
  });

  beforeEach(async () => {
    await resetDb(app);
    verify = () => Promise.resolve(profile);
  });

  afterAll(async () => {
    await app.close();
  });

  it('tạo tài khoản mới, đã verified, role USER, không có mật khẩu', async () => {
    const res = await login().expect(200);
    const { user, tokens } = body<LoginBody>(res);

    expect(user.email).toBe(profile.email);
    expect(user.name).toBe(profile.name);
    expect(user.avatar).toBe(profile.avatar);
    expect(user.isVerified).toBe(true);
    expect(user.roles).toEqual([RoleName.USER]);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();

    const row = await db(app).user.findUnique({
      where: { email: profile.email },
    });
    expect(row?.googleId).toBe(profile.googleId);
    expect(row?.password).toBeNull();
  });

  it('access token trả về dùng được cho endpoint cần đăng nhập', async () => {
    const { tokens } = body<LoginBody>(await login().expect(200));

    await http(app)
      .get('/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
  });

  it('đăng nhập lần hai dùng lại đúng user, không tạo bản ghi mới', async () => {
    const first = body<LoginBody>(await login().expect(200));
    const second = body<LoginBody>(await login().expect(200));

    expect(second.user.id).toBe(first.user.id);
    expect(await db(app).user.count()).toBe(1);
  });

  it('liên kết vào tài khoản local cùng email thay vì tạo tài khoản thứ hai', async () => {
    const local = await seedUser(app, {
      email: profile.email,
      name: 'Tên tự đặt',
    });

    const { user } = body<LoginBody>(await login().expect(200));

    expect(user.id).toBe(local.id);
    expect(user.name).toBe('Tên tự đặt'); // không ghi đè tên người dùng tự sửa
    expect(await db(app).user.count()).toBe(1);

    const row = await db(app).user.findUnique({ where: { id: local.id } });
    expect(row?.googleId).toBe(profile.googleId);
    expect(row?.password).not.toBeNull(); // vẫn đăng nhập bằng mật khẩu được
  });

  it('liên kết vào tài khoản CHƯA kích hoạt thì xoá mật khẩu cũ', async () => {
    await http(app)
      .post('/auth/register')
      .send({
        name: 'Attacker',
        email: profile.email,
        password: 'attacker123',
        confirmPassword: 'attacker123',
      })
      .expect(201);

    const { user } = body<LoginBody>(await login().expect(200));

    const row = await db(app).user.findUnique({ where: { id: user.id } });
    expect(row?.password).toBeNull();

    await http(app)
      .post('/auth/login')
      .send({ email: profile.email, password: 'attacker123' })
      .expect(401);
  });

  it('liên kết vào tài khoản ĐÃ kích hoạt thì giữ nguyên mật khẩu', async () => {
    const local = await seedUser(app, {
      email: profile.email,
      password: 'secret123',
      isVerified: true,
    });

    await login().expect(200);

    await http(app)
      .post('/auth/login')
      .send({ email: local.email, password: 'secret123' })
      .expect(200);
  });

  it('email đăng ký khác hoa thường vẫn liên kết đúng, không tạo tài khoản thứ hai', async () => {
    await http(app)
      .post('/auth/register')
      .send({
        name: 'Gina',
        email: profile.email.toUpperCase(),
        password: 'secret123',
        confirmPassword: 'secret123',
      })
      .expect(201);

    await login().expect(200);

    expect(await db(app).user.count()).toBe(1);
  });

  it('tài khoản bị khoá không bị ghi googleId trước khi trả 403', async () => {
    const local = await seedUser(app, {
      email: profile.email,
      status: UserStatus.INACTIVE,
    });

    await login().expect(403);

    const row = await db(app).user.findUnique({ where: { id: local.id } });
    expect(row?.googleId).toBeNull();
  });

  it('hai request đăng nhập đầu tiên chạy song song chỉ tạo một user', async () => {
    const [a, b] = await Promise.all([login(), login()]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(body<LoginBody>(a).user.id).toBe(body<LoginBody>(b).user.id);
    expect(await db(app).user.count()).toBe(1);
  });

  it('token Google không hợp lệ -> 401, không tạo user', async () => {
    verify = () => Promise.reject(new UnauthorizedException('bad token'));

    await login().expect(401);
    expect(await db(app).user.count()).toBe(0);
  });

  it('thiếu idToken -> 400', async () => {
    await http(app).post('/auth/google').send({}).expect(400);
  });

  it('tài khoản bị khoá -> 403', async () => {
    await seedUser(app, { email: profile.email, status: UserStatus.INACTIVE });

    const res = await login().expect(403);
    expect(body<ErrorBody>(res).errors.body.length).toBeGreaterThan(0);
  });

  it('tài khoản Google chưa có mật khẩu -> đổi mật khẩu báo 400', async () => {
    const { tokens } = body<LoginBody>(await login().expect(200));

    await http(app)
      .patch('/users/me/password')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ oldPassword: 'khong-co-gi', newPassword: 'newsecret123' })
      .expect(400);
  });
});
