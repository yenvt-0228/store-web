import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../upload/storage.service';

@Injectable()
export class ImageCleanupService {
  private readonly logger = new Logger(ImageCleanupService.name);

  private static readonly RETENTION_DAYS = 30;

  private static readonly BATCH_SIZE = 500;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupImages(): Promise<void> {
    const orphans = await this.markOrphans();
    const purged = await this.purgeExpired();

    if (orphans === 0 && purged.rows === 0) return;

    this.logger.log(
      `Đã dọn ảnh: mồ côi=${orphans}, xoá cứng=${purged.rows}, object trên storage=${purged.objects}`,
    );
  }

  private async markOrphans(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "images" SET "deleted_at" = now(), "is_primary" = false
      WHERE "deleted_at" IS NULL
        AND (
          ("entity_type" = 'PRODUCT'
            AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."id" = "images"."entity_id"))
          OR
          ("entity_type" = 'USER'
            AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "images"."entity_id"))
        )
    `;
  }

  private async purgeExpired(): Promise<{ rows: number; objects: number }> {
    const cutoff = new Date(
      Date.now() - ImageCleanupService.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const expired = await this.prisma.image.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true, imageUrl: true },
      take: ImageCleanupService.BATCH_SIZE,
    });

    if (expired.length === 0) return { rows: 0, objects: 0 };

    const keys = expired
      .map((image) => this.storage.keyFromUrl(image.imageUrl))
      .filter((key): key is string => key !== null);

    const objects = await this.storage.deleteMany(keys);

    const { count } = await this.prisma.image.deleteMany({
      where: { id: { in: expired.map((image) => image.id) } },
    });

    return { rows: count, objects };
  }
}
