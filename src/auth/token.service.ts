import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TokenService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private i18n: I18nService,
  ) {}

  private generateRawToken(): string {
    return randomBytes(32).toString('hex');
  }

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private expiresInMs(ms: number): Date {
    return new Date(Date.now() + ms);
  }

  async issueEmailVerificationToken(userId: string): Promise<string> {
    const rawToken = this.generateRawToken();
    const hours = Number(
      this.config.get<string>('EMAIL_VERIFICATION_TTL_HOURS') ?? 24,
    );

    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        token: this.hash(rawToken),
        expiresAt: this.expiresInMs(hours * 60 * 60 * 1000),
      },
    });

    return rawToken;
  }

  async consumeEmailVerificationToken(rawToken: string): Promise<string> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { token: this.hash(rawToken) },
    });

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException(this.i18n.t('auth.INVALID_TOKEN'));
    }

    await this.prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    return record.userId;
  }

  async issuePasswordResetToken(userId: string): Promise<string> {
    const rawToken = this.generateRawToken();
    const minutes = Number(
      this.config.get<string>('PASSWORD_RESET_TTL_MINUTES') ?? 60,
    );

    await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        token: this.hash(rawToken),
        expiresAt: this.expiresInMs(minutes * 60 * 1000),
      },
    });

    return rawToken;
  }

  async consumePasswordResetToken(rawToken: string): Promise<string> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: this.hash(rawToken) },
    });

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException(this.i18n.t('auth.INVALID_TOKEN'));
    }

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    return record.userId;
  }

  async issueRefreshToken(userId: string): Promise<string> {
    const rawToken = this.generateRawToken();
    const days = Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 7);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: this.hash(rawToken),
        expiresAt: this.expiresInMs(days * 24 * 60 * 60 * 1000),
      },
    });

    return rawToken;
  }

  async rotateRefreshToken(
    rawToken: string,
  ): Promise<{ userId: string; refreshToken: string }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token: this.hash(rawToken) },
    });

    if (!record) {
      throw new UnauthorizedException(this.i18n.t('auth.INVALID_TOKEN'));
    }

    if (record.revokedAt) {
      await this.revokeAllRefreshTokens(record.userId);
      throw new UnauthorizedException(this.i18n.t('auth.TOKEN_REUSED'));
    }

    if (record.expiresAt <= new Date()) {
      throw new UnauthorizedException(this.i18n.t('auth.INVALID_TOKEN'));
    }

    const newRawToken = this.generateRawToken();
    const days = Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 7);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: record.userId,
          token: this.hash(newRawToken),
          expiresAt: this.expiresInMs(days * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return { userId: record.userId, refreshToken: newRawToken };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { token: this.hash(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new UnauthorizedException(this.i18n.t('auth.INVALID_TOKEN'));
    }
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
