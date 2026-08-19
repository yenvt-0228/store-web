import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredTokens(): Promise<void> {
    const now = new Date();
    const keepUntil = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [refresh, verification, reset] = await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: keepUntil } }],
        },
      }),
      this.prisma.emailVerificationToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { usedAt: { lt: keepUntil } }],
        },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { usedAt: { lt: keepUntil } }],
        },
      }),
    ]);

    this.logger.log(
      `Đã dọn token: refresh=${refresh.count}, verification=${verification.count}, reset=${reset.count}`,
    );
  }
}
