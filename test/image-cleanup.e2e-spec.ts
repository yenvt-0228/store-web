import { INestApplication } from '@nestjs/common';
import { ImageEntityType } from '../src/generated/prisma/enums';
import { ImageCleanupService } from '../src/tasks/image-cleanup.service';
import {
  createTestApp,
  db,
  resetDb,
  seedCategory,
  seedProduct,
  seedProductImage,
  seedUser,
} from './test-helpers';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe('ImageCleanup (e2e) — cron dọn ảnh', () => {
  let app: INestApplication;
  let cleanup: ImageCleanupService;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    cleanup = app.get(ImageCleanupService);
  });

  beforeEach(async () => {
    await resetDb(app);
    categoryId = (await seedCategory(app, 'Điện tử')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const countImages = () => db(app).image.count();

  it('ảnh xoá mềm CHƯA quá 30 ngày -> giữ lại, còn khôi phục được', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, { deletedAt: daysAgo(29) });

    await cleanup.cleanupImages();

    expect(await countImages()).toBe(1);
  });

  it('ảnh xoá mềm QUÁ 30 ngày -> xoá cứng', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, { deletedAt: daysAgo(31) });

    await cleanup.cleanupImages();

    expect(await countImages()).toBe(0);
  });

  it('ảnh đang hoạt động -> không bao giờ bị dọn', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, { isPrimary: true });

    await cleanup.cleanupImages();

    expect(await countImages()).toBe(1);
  });

  it('sản phẩm bị xoá CỨNG -> ảnh thành mồ côi, được đánh dấu xoá mềm', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, { isPrimary: true });

    await db(app).product.delete({ where: { id: product.id } });
    await cleanup.cleanupImages();

    const row = await db(app).image.findFirstOrThrow({
      where: { entityId: product.id },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isPrimary).toBe(false);
  });

  it('ảnh mồ côi -> xoá cứng ở lượt chạy SAU khi đã hết thời gian lưu giữ', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id);
    await db(app).product.delete({ where: { id: product.id } });

    await cleanup.cleanupImages();
    expect(await countImages()).toBe(1);

    await db(app).image.updateMany({
      where: { entityId: product.id },
      data: { deletedAt: daysAgo(31) },
    });

    await cleanup.cleanupImages();
    expect(await countImages()).toBe(0);
  });

  it('ảnh của USER cũng được đối chiếu, không chỉ PRODUCT', async () => {
    const user = await seedUser(app, { email: 'ai-do@example.com' });
    await db(app).image.create({
      data: {
        entityType: ImageEntityType.USER,
        entityId: user.id,
        imageUrl: 'https://cdn.example.com/avatar.jpg',
      },
    });

    await cleanup.cleanupImages();
    expect(
      (await db(app).image.findFirstOrThrow({ where: { entityId: user.id } }))
        .deletedAt,
    ).toBeNull();

    await db(app).user.delete({ where: { id: user.id } });
    await cleanup.cleanupImages();

    expect(
      (await db(app).image.findFirstOrThrow({ where: { entityId: user.id } }))
        .deletedAt,
    ).not.toBeNull();
  });

  it('entityId trỏ vào id không tồn tại ngay từ đầu -> vẫn bị bắt', async () => {
    await db(app).image.create({
      data: {
        entityType: ImageEntityType.PRODUCT,
        entityId: '00000000-0000-4000-8000-000000000000',
        imageUrl: 'https://cdn.example.com/rac.jpg',
      },
    });

    await cleanup.cleanupImages();

    expect((await db(app).image.findFirstOrThrow({})).deletedAt).not.toBeNull();
  });

  describe('object đã upload nhưng không ai tham chiếu', () => {
    const seedUpload = (url: string, createdAt = new Date()) =>
      db(app).uploadedObject.create({
        data: { objectKey: url.split('/').pop()!, url, createdAt },
      });

    const countUploads = () => db(app).uploadedObject.count();

    it('upload xong bỏ ngang, QUÁ hạn chờ -> xoá', async () => {
      await seedUpload(
        'https://cdn.example.com/products/bo-ngang.jpg',
        daysAgo(2),
      );

      await cleanup.cleanupImages();

      expect(await countUploads()).toBe(0);
    });

    it('vừa upload, CHƯA quá hạn chờ -> giữ lại cho client kịp gắn vào entity', async () => {
      await seedUpload('https://cdn.example.com/products/vua-upload.jpg');

      await cleanup.cleanupImages();

      expect(await countUploads()).toBe(1);
    });

    it('đã gắn vào ảnh sản phẩm -> không đụng tới dù quá hạn', async () => {
      const url = 'https://cdn.example.com/products/da-gan.jpg';
      const product = await seedProduct(app, { categoryId });
      await seedProductImage(app, product.id, { imageUrl: url });
      await seedUpload(url, daysAgo(2));

      await cleanup.cleanupImages();

      expect(await countUploads()).toBe(1);
    });

    it('đang là avatar của user -> không đụng tới dù quá hạn', async () => {
      const url = 'https://cdn.example.com/avatars/dang-dung.jpg';
      const user = await seedUser(app, { email: 'co-avatar@example.com' });
      await db(app).user.update({
        where: { id: user.id },
        data: { avatar: url },
      });
      await seedUpload(url, daysAgo(2));

      await cleanup.cleanupImages();

      expect(await countUploads()).toBe(1);
    });

    it('avatar cũ sau khi user đổi ảnh -> thành rác và bị xoá', async () => {
      const cu = 'https://cdn.example.com/avatars/cu.jpg';
      const moi = 'https://cdn.example.com/avatars/moi.jpg';

      const user = await seedUser(app, { email: 'doi-avatar@example.com' });
      await db(app).user.update({
        where: { id: user.id },
        data: { avatar: cu },
      });
      await seedUpload(cu, daysAgo(2));
      await seedUpload(moi, daysAgo(2));

      // Đổi sang ảnh mới -> ảnh cũ không còn ai trỏ tới
      await db(app).user.update({
        where: { id: user.id },
        data: { avatar: moi },
      });

      await cleanup.cleanupImages();

      const con_lai = await db(app).uploadedObject.findMany();
      expect(con_lai.map((row) => row.url)).toEqual([moi]);
    });

    it('user có avatar NULL không làm hỏng phép đối chiếu', async () => {
      // NOT IN với tập chứa NULL sẽ không khớp dòng nào — bug kinh điển.
      await seedUser(app, { email: 'khong-avatar@example.com' });
      await seedUpload('https://cdn.example.com/products/rac.jpg', daysAgo(2));

      await cleanup.cleanupImages();

      expect(await countUploads()).toBe(0);
    });
  });

  it('chạy nhiều lượt liên tiếp -> không đổi gì thêm (idempotent)', async () => {
    const product = await seedProduct(app, { categoryId });
    await seedProductImage(app, product.id, { isPrimary: true });
    await seedProductImage(app, product.id, { deletedAt: daysAgo(31) });

    await cleanup.cleanupImages();
    const after = await countImages();

    await cleanup.cleanupImages();
    await cleanup.cleanupImages();

    expect(await countImages()).toBe(after);
    expect(after).toBe(1);
  });
});
