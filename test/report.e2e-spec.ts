import { INestApplication } from '@nestjs/common';
import { RoleName } from '../src/common/constants/role.constant';
import {
  body,
  createTestApp,
  ErrorBody,
  http,
  resetDb,
  seedUser,
} from './test-helpers';

// REPORT_QUEUE_ENABLED không bật trong .env.test, nên bộ này kiểm phần HTTP:
// phân quyền, validate, và cách hệ thống từ chối khi thiếu hàng đợi. Phần dựng
// file (CPU, chạy trong worker thread) được kiểm ở src/report/orders-sheet.spec.ts.
describe('Report (e2e) — xuất báo cáo đơn hàng', () => {
  let app: INestApplication;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const requestReport = (token?: string) => {
    const req = http(app).post('/admin/reports/orders');
    return token ? req.set(auth(token)) : req;
  };

  it('không có token -> 401', async () => {
    await requestReport().send({}).expect(401);
  });

  it('user thường -> 403, không được xuất dữ liệu toàn hệ thống', async () => {
    const member = await seedUser(app, { email: 'member@e2e.local' });

    await requestReport(member.accessToken).send({}).expect(403);
  });

  it('admin nhưng chưa bật hàng đợi -> 503 chứ không dựng file ngay trong request', async () => {
    const admin = await seedUser(app, {
      email: 'admin@e2e.local',
      roles: [RoleName.ADMIN],
    });

    const res = await requestReport(admin.accessToken).send({}).expect(503);

    expect(body<ErrorBody>(res).errors.body[0]).toMatch(/queue/i);
  });

  it('ngày sai định dạng -> 400 trước khi chạm tới hàng đợi', async () => {
    const admin = await seedUser(app, {
      email: 'admin2@e2e.local',
      roles: [RoleName.ADMIN],
    });

    const res = await requestReport(admin.accessToken)
      .send({ from: 'hom-qua' })
      .expect(400);

    expect(body<ErrorBody>(res).errors.body.join(' ')).toMatch(/from/);
  });

  it('status không thuộc enum -> 400', async () => {
    const admin = await seedUser(app, {
      email: 'admin3@e2e.local',
      roles: [RoleName.ADMIN],
    });

    await requestReport(admin.accessToken)
      .send({ status: 'KHONG_TON_TAI' })
      .expect(400);
  });

  it('tra trạng thái job khi chưa bật hàng đợi -> 503', async () => {
    const admin = await seedUser(app, {
      email: 'admin4@e2e.local',
      roles: [RoleName.ADMIN],
    });

    await http(app)
      .get('/admin/reports/orders/1')
      .set(auth(admin.accessToken))
      .expect(503);
  });

  // File báo cáo chứa email/điện thoại/địa chỉ của mọi khách hàng nên KHÔNG
  // được phát URL storage; đường tải duy nhất phải đi qua guard ADMIN.
  it('tải file: user thường -> 403', async () => {
    const member = await seedUser(app, { email: 'member2@e2e.local' });

    await http(app)
      .get('/admin/reports/orders/1/download')
      .set(auth(member.accessToken))
      .expect(403);
  });

  it('tải file: không token -> 401', async () => {
    await http(app).get('/admin/reports/orders/1/download').expect(401);
  });
});
