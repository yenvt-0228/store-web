import { INestApplication } from '@nestjs/common';
import { UserStatus } from '../src/generated/prisma/enums';
import {
  CapturedMail,
  ErrorBody,
  LoginBody,
  MessageBody,
  RegisterBody,
  TokensBody,
  body,
  captureMails,
  createTestApp,
  db,
  findRefreshToken,
  http,
  resetDb,
  seedEmailVerificationToken,
  seedPasswordResetToken,
  seedRefreshToken,
  seedUser,
} from './test-helpers';

describe('Auth flow (e2e)', () => {
  let app: INestApplication;
  let mails: CapturedMail[];

  const creds = {
    name: 'Alice',
    email: 'alice@example.com',
    password: 'secret123',
    confirmPassword: 'secret123',
  };

  beforeAll(async () => {
    app = await createTestApp();
    mails = captureMails(app);
  });

  beforeEach(async () => {
    await resetDb(app);
    mails.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/register -> 201, tài khoản CHƯA kích hoạt + gán role USER', async () => {
    const res = await http(app).post('/auth/register').send(creds).expect(201);

    const { user, message } = body<RegisterBody>(res);
    expect(user.email).toBe(creds.email);
    expect(user.isVerified).toBe(false);
    expect(user.roles).toEqual(['USER']);
    expect(user).not.toHaveProperty('password');
    expect(message).toBeTruthy();

    const inDb = await db(app).user.findUnique({
      where: { email: creds.email },
    });
    expect(inDb?.password).not.toBe(creds.password);
  });

  it('POST /auth/register phát sinh token kích hoạt + sự kiện gửi mail', async () => {
    await http(app).post('/auth/register').send(creds).expect(201);

    expect(mails).toHaveLength(1);
    expect(mails[0].event).toBe('user.registered');
    expect(mails[0].email).toBe(creds.email);
    expect(mails[0].token).toEqual(expect.any(String));

    const tokens = await db(app).emailVerificationToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token).not.toBe(mails[0].token);
  });

  it('POST /auth/register email đã tồn tại -> 409', async () => {
    await seedUser(app, { email: creds.email });

    const res = await http(app).post('/auth/register').send(creds).expect(409);
    expect(body<ErrorBody>(res).errors.body.length).toBeGreaterThan(0);
  });

  it('POST /auth/register confirmPassword lệch -> 400', async () => {
    const res = await http(app)
      .post('/auth/register')
      .send({ ...creds, confirmPassword: 'khac-mat-khau' })
      .expect(400);

    expect(body<ErrorBody>(res).errors.body.length).toBeGreaterThan(0);
  });

  it('POST /auth/register dữ liệu sai -> 400 { errors: { body } }', async () => {
    const res = await http(app)
      .post('/auth/register')
      .send({ name: '', email: 'sai', password: '123' })
      .expect(400);

    const { errors } = body<ErrorBody>(res);
    expect(Array.isArray(errors.body)).toBe(true);
    expect(errors.body.length).toBeGreaterThan(0);
  });

  it('GET /auth/activate -> 200 và user chuyển sang đã kích hoạt', async () => {
    await http(app).post('/auth/register').send(creds).expect(201);
    const token = mails[0].token as string;

    await http(app).get('/auth/activate').query({ token }).expect(200);

    const inDb = await db(app).user.findUnique({
      where: { email: creds.email },
    });
    expect(inDb?.isVerified).toBe(true);
  });

  it('GET /auth/activate dùng lại token đã kích hoạt -> 401', async () => {
    await http(app).post('/auth/register').send(creds).expect(201);
    const token = mails[0].token as string;

    await http(app).get('/auth/activate').query({ token }).expect(200);
    await http(app).get('/auth/activate').query({ token }).expect(401);
  });

  it('GET /auth/activate token hết hạn -> 401', async () => {
    const user = await seedUser(app, { isVerified: false });
    const token = await seedEmailVerificationToken(app, user.id, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await http(app).get('/auth/activate').query({ token }).expect(401);
  });

  it('GET /auth/activate token sai -> 401', async () => {
    await http(app)
      .get('/auth/activate')
      .query({ token: 'khong-ton-tai' })
      .expect(401);
  });

  it('POST /auth/login -> 200 kèm accessToken + refreshToken', async () => {
    const user = await seedUser(app, { email: creds.email });

    const res = await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    const { user: payload, tokens } = body<LoginBody>(res);
    expect(payload.email).toBe(user.email);
    expect(tokens.accessToken).toEqual(expect.any(String));
    expect(tokens.refreshToken).toEqual(expect.any(String));
    expect(tokens.tokenType).toBe('Bearer');

    expect(await db(app).refreshToken.count()).toBe(1);
  });

  it('POST /auth/login sai mật khẩu -> 401', async () => {
    const user = await seedUser(app);

    await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'sai-mat-khau' })
      .expect(401);
  });

  it('POST /auth/login email không tồn tại -> 401', async () => {
    await http(app)
      .post('/auth/login')
      .send({ email: 'khongco@example.com', password: 'secret123' })
      .expect(401);
  });

  it('POST /auth/login tài khoản chưa kích hoạt -> 403', async () => {
    const user = await seedUser(app, { isVerified: false });

    await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(403);
  });

  it('POST /auth/login tài khoản bị khóa -> 403', async () => {
    const user = await seedUser(app, { status: UserStatus.INACTIVE });

    await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(403);
  });

  it('POST /auth/refresh -> 200, token cũ bị thu hồi (rotation)', async () => {
    const user = await seedUser(app);
    const oldToken = await seedRefreshToken(app, user.id);

    const res = await http(app)
      .post('/auth/refresh')
      .send({ refreshToken: oldToken })
      .expect(200);

    const { tokens } = body<TokensBody>(res);
    expect(tokens.refreshToken).not.toBe(oldToken);
    expect((await findRefreshToken(app, oldToken))?.revokedAt).not.toBeNull();
  });

  it('POST /auth/refresh dùng lại token đã thu hồi -> 401 và thu hồi TOÀN BỘ phiên', async () => {
    const user = await seedUser(app);
    const stolen = await seedRefreshToken(app, user.id);
    const other = await seedRefreshToken(app, user.id);

    await http(app)
      .post('/auth/refresh')
      .send({ refreshToken: stolen })
      .expect(200);

    await http(app)
      .post('/auth/refresh')
      .send({ refreshToken: stolen })
      .expect(401);

    expect((await findRefreshToken(app, other))?.revokedAt).not.toBeNull();
  });

  it('POST /auth/refresh token hết hạn -> 401', async () => {
    const user = await seedUser(app);
    const expired = await seedRefreshToken(app, user.id, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await http(app)
      .post('/auth/refresh')
      .send({ refreshToken: expired })
      .expect(401);
  });

  it('POST /auth/logout -> 200 và refresh token bị thu hồi', async () => {
    const user = await seedUser(app);
    const token = await seedRefreshToken(app, user.id);

    const res = await http(app)
      .post('/auth/logout')
      .send({ refreshToken: token })
      .expect(200);

    expect(body<MessageBody>(res).message).toBeTruthy();
    expect((await findRefreshToken(app, token))?.revokedAt).not.toBeNull();

    await http(app)
      .post('/auth/refresh')
      .send({ refreshToken: token })
      .expect(401);
  });

  it('POST /auth/forgot-password -> 200 và gửi mail kèm token', async () => {
    const user = await seedUser(app);

    await http(app)
      .post('/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    expect(mails).toHaveLength(1);
    expect(mails[0].event).toBe('user.password-reset-requested');
    expect(await db(app).passwordResetToken.count()).toBe(1);
  });

  it('POST /auth/forgot-password email lạ -> vẫn 200, KHÔNG lộ email tồn tại hay không', async () => {
    const res = await http(app)
      .post('/auth/forgot-password')
      .send({ email: 'khongco@example.com' })
      .expect(200);

    expect(body<MessageBody>(res).message).toBeTruthy();
    expect(mails).toHaveLength(0);
    expect(await db(app).passwordResetToken.count()).toBe(0);
  });

  it('POST /auth/reset-password -> đổi được mật khẩu và đăng nhập bằng mật khẩu mới', async () => {
    const user = await seedUser(app);
    const token = await seedPasswordResetToken(app, user.id);

    await http(app)
      .post('/auth/reset-password')
      .send({
        token,
        password: 'matkhaumoi',
        confirmPassword: 'matkhaumoi',
      })
      .expect(200);

    await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'matkhaumoi' })
      .expect(200);

    // Mật khẩu cũ hết tác dụng.
    await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(401);
  });

  it('POST /auth/reset-password thu hồi mọi refresh token đang có', async () => {
    const user = await seedUser(app);
    const session = await seedRefreshToken(app, user.id);
    const token = await seedPasswordResetToken(app, user.id);

    await http(app)
      .post('/auth/reset-password')
      .send({
        token,
        password: 'matkhaumoi',
        confirmPassword: 'matkhaumoi',
      })
      .expect(200);

    expect((await findRefreshToken(app, session))?.revokedAt).not.toBeNull();
  });

  it('POST /auth/reset-password token đã dùng -> 401', async () => {
    const user = await seedUser(app);
    const token = await seedPasswordResetToken(app, user.id, {
      usedAt: new Date(),
    });

    await http(app)
      .post('/auth/reset-password')
      .send({
        token,
        password: 'matkhaumoi',
        confirmPassword: 'matkhaumoi',
      })
      .expect(401);
  });
});
