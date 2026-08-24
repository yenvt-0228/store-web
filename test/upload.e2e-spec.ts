import { INestApplication } from '@nestjs/common';
import { RoleName } from '../src/common/constants/role.constant';
import {
  SeededUser,
  body,
  createTestApp,
  http,
  resetDb,
  seedUser,
} from './test-helpers';

interface UploadedImage {
  url: string;
  key: string;
}
type ImagesBody = { images: UploadedImage[] };
type ImageBody = { image: UploadedImage };

const png = (size = 64) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(size),
  ]);
const jpeg = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const webp = () =>
  Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(64),
  ]);

describe('Upload (e2e) — ảnh lên S3/R2', () => {
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

  it('POST /admin/uploads/images -> trả url + key, key mang uuid và đúng đuôi', async () => {
    const res = await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .attach('files', png(), 'anh.png')
      .expect(201);

    const { images } = body<ImagesBody>(res);
    expect(images).toHaveLength(1);
    expect(images[0].key).not.toContain('anh.png');
    expect(images[0].key).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    expect(images[0].url).toContain(images[0].key);
  });

  it('POST /admin/uploads/images nhiều file -> mỗi file một key riêng', async () => {
    const res = await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .attach('files', png(), 'a.png')
      .attach('files', jpeg(), 'b.jpg')
      .attach('files', webp(), 'c.webp')
      .expect(201);

    const { images } = body<ImagesBody>(res);
    expect(images).toHaveLength(3);
    expect(new Set(images.map((i) => i.key)).size).toBe(3);
    expect(images.map((i) => i.key.split('.').pop())).toEqual([
      'png',
      'jpg',
      'webp',
    ]);
  });

  it('đuôi file được lấy từ MAGIC BYTES, không từ tên file client gửi', async () => {
    const res = await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .attach('files', png(), 'that-la-anh-png.jpg')
      .expect(201);

    expect(body<ImagesBody>(res).images[0].key).toMatch(/\.png$/);
  });

  it('file không phải ảnh -> 400, kể cả khi khai Content-Type là image/png', async () => {
    await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .attach('files', Buffer.from('<html><script>alert(1)</script></html>'), {
        filename: 'xss.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('SVG bị từ chối — XML nhúng được script', async () => {
    await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .attach(
        'files',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        {
          filename: 'a.svg',
          contentType: 'image/svg+xml',
        },
      )
      .expect(400);
  });

  it('file rỗng / quá ngắn để đọc magic bytes -> 400', async () => {
    await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .attach('files', Buffer.from([0x89, 0x50]), 'ngan.png')
      .expect(400);
  });

  it('không gửi file nào -> 400', async () => {
    await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .expect(400);
  });

  it('gửi ĐÚNG 10 file -> nhận hết', async () => {
    let req = http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken));
    for (let i = 0; i < 10; i++) req = req.attach('files', png(), `a${i}.png`);

    const res = await req.expect(201);
    const { images } = body<ImagesBody>(res);
    expect(images).toHaveLength(10);
    // Mỗi file một key riêng, không có chuyện ghi đè nhau.
    expect(new Set(images.map((i) => i.key)).size).toBe(10);
  });

  it('gửi 11 file -> bị chặn ở tầng multer, KHÔNG file nào được lưu', async () => {
    let req = http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken));
    for (let i = 0; i < 11; i++) req = req.attach('files', png(), `a${i}.png`);

    const res = await req.expect(400);
    // Thông báo phải nói đúng chuyện gửi quá nhiều file, không phải "field lạ".
    expect(JSON.stringify(res.body)).toContain('Too many files');
  });

  it('ảnh quá 5MB -> bị chặn', async () => {
    await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .attach('files', png(6 * 1024 * 1024), 'to.png')
      .expect(413);
  });

  it('token USER -> 403', async () => {
    await http(app)
      .post('/admin/uploads/images')
      .set(auth(member.accessToken))
      .attach('files', png(), 'a.png')
      .expect(403);
  });

  it('không token -> 401', async () => {
    await http(app)
      .post('/admin/uploads/images')
      .attach('files', png(), 'a.png')
      .expect(401);
  });

  /*  ẢNH ĐẠI DIỆN */

  it('POST /uploads/avatar -> user thường upload được, key vào thư mục avatars', async () => {
    const res = await http(app)
      .post('/uploads/avatar')
      .set(auth(member.accessToken))
      .attach('file', jpeg(), 'toi.jpg')
      .expect(201);

    expect(body<ImageBody>(res).image.key).toMatch(
      /^avatars\/[0-9a-f-]{36}\.jpg$/,
    );
  });

  it('POST /uploads/avatar không token -> 401', async () => {
    await http(app)
      .post('/uploads/avatar')
      .attach('file', jpeg(), 'a.jpg')
      .expect(401);
  });

  it('URL avatar vừa upload dùng được cho PATCH /users/me', async () => {
    const uploaded = await http(app)
      .post('/uploads/avatar')
      .set(auth(member.accessToken))
      .attach('file', jpeg(), 'toi.jpg')
      .expect(201);

    const { url } = body<ImageBody>(uploaded).image;

    await http(app)
      .patch('/users/me')
      .set(auth(member.accessToken))
      .send({ avatar: url })
      .expect(200);
  });

  /* ẢNH SẢN PHẨM */

  it('URL vừa upload dùng được cho POST /admin/products kèm ảnh', async () => {
    const uploaded = await http(app)
      .post('/admin/uploads/images')
      .set(auth(admin.accessToken))
      .attach('files', png(), 'a.png')
      .expect(201);

    const { url } = body<ImagesBody>(uploaded).images[0];

    const category = await http(app)
      .post('/admin/categories')
      .set(auth(admin.accessToken))
      .send({ name: 'Điện tử' })
      .expect(201);

    const res = await http(app)
      .post('/admin/products')
      .set(auth(admin.accessToken))
      .send({
        name: 'Máy ảnh',
        categoryId: body<{ category: { id: string } }>(category).category.id,
        price: 1000,
        quantity: 1,
        images: [{ imageUrl: url }],
      })
      .expect(201);

    expect(
      body<{ product: { primaryImage: string | null } }>(res).product
        .primaryImage,
    ).toBe(url);
  });
});
