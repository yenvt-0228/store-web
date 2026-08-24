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
