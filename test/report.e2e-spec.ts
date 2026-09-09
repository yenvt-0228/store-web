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

// REPORT_QUEUE_ENABLED is off in .env.test, so this suite covers the HTTP side:
// authorization, validation, and how the system refuses when the queue is
// missing. Building the file (CPU work on a worker thread) is covered by
// src/report/orders-sheet.spec.ts.
describe('Report (e2e) — orders report export', () => {
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

  it('rejects a request without a token with 401', async () => {
    await requestReport().send({}).expect(401);
  });

  it('rejects a regular user with 403: no system-wide data export', async () => {
    const member = await seedUser(app, { email: 'member@e2e.local' });

    await requestReport(member.accessToken).send({}).expect(403);
  });

  it('answers 503 for an admin when the queue is off, rather than building the file inside the request', async () => {
    const admin = await seedUser(app, {
      email: 'admin@e2e.local',
      roles: [RoleName.ADMIN],
    });

    const res = await requestReport(admin.accessToken).send({}).expect(503);

    expect(body<ErrorBody>(res).errors.body[0]).toMatch(/queue/i);
  });

  it('answers 400 for a malformed date before reaching the queue', async () => {
    const admin = await seedUser(app, {
      email: 'admin2@e2e.local',
      roles: [RoleName.ADMIN],
    });

    const res = await requestReport(admin.accessToken)
      .send({ from: 'hom-qua' })
      .expect(400);

    expect(body<ErrorBody>(res).errors.body.join(' ')).toMatch(/from/);
  });

  it('answers 400 for a status outside the enum', async () => {
    const admin = await seedUser(app, {
      email: 'admin3@e2e.local',
      roles: [RoleName.ADMIN],
    });

    await requestReport(admin.accessToken)
      .send({ status: 'KHONG_TON_TAI' })
      .expect(400);
  });

  it('answers 503 when polling job status while the queue is off', async () => {
    const admin = await seedUser(app, {
      email: 'admin4@e2e.local',
      roles: [RoleName.ADMIN],
    });

    await http(app)
      .get('/admin/reports/orders/1')
      .set(auth(admin.accessToken))
      .expect(503);
  });

  // The report file holds the email, phone number and address of every
  // customer, so no storage URL may be handed out: the only download path has
  // to pass the ADMIN guard.
  it('download: rejects a regular user with 403', async () => {
    const member = await seedUser(app, { email: 'member2@e2e.local' });

    await http(app)
      .get('/admin/reports/orders/1/download')
      .set(auth(member.accessToken))
      .expect(403);
  });

  it('download: rejects a request without a token with 401', async () => {
    await http(app).get('/admin/reports/orders/1/download').expect(401);
  });
});
