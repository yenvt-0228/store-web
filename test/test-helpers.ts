import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { Locale } from '../src/common/constants/locale.constant';
import { DEFAULT_LOCALE } from '../src/common/constants/locale.constant';
import { RoleName } from '../src/common/constants/role.constant';
import { MailEvent } from '../src/common/events/mail.event';
import { OrderEvent } from '../src/common/events/order.event';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import {
  ImageEntityType,
  OrderPaymentStatus,
  PaymentStatus,
  ProductStatus,
  UserStatus,
} from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

export interface UserPayload {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  avatar: string | null;
  status: UserStatus;
  isVerified: boolean;
  roles: string[];
  createdAt: string;
}

export interface TokensPayload {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

export type UserBody = { user: UserPayload };
export type RegisterBody = { user: UserPayload; message: string };
export type LoginBody = { user: UserPayload; tokens: TokensPayload };
export type TokensBody = { tokens: TokensPayload };
export type MessageBody = { message: string };
export type ErrorBody = { errors: { body: string[] } };
export type UserListBody = {
  data: UserPayload[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export function body<T>(res: request.Response): T {
  return res.body as T;
}

export function http(app: INestApplication) {
  return request(app.getHttpServer() as App);
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new I18nValidationPipe({ whitelist: true, transform: true }),
  );

  app.useGlobalFilters(
    new HttpExceptionFilter(),
    new ValidationExceptionFilter({ detailedErrors: false }),
  );
  await app.init();
  return app;
}

export async function resetDb(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "images","payments","order_items","orders","products","categories","refresh_tokens","email_verification_tokens","password_reset_tokens","user_roles","roles","users" RESTART IDENTITY CASCADE',
  );
  const redis = app.get(RedisService);
  await redis.ensureConnected();
  await redis.client.flushdb();
}

export function db(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

export interface SeededUser {
  id: string;
  name: string;
  email: string;
  password: string;
  roles: string[];
  accessToken: string;
}

export async function seedUser(
  app: INestApplication,
  overrides: {
    name?: string;
    email?: string;
    password?: string;
    roles?: string[];
    isVerified?: boolean;
    status?: UserStatus;
    locale?: Locale;
  } = {},
): Promise<SeededUser> {
  const password = overrides.password ?? 'secret123';
  const email = overrides.email ?? 'e2e@example.com';
  const roles = overrides.roles ?? [RoleName.USER];

  const user = await db(app).user.create({
    data: {
      name: overrides.name ?? 'E2E User',
      email,
      password: await bcrypt.hash(password, 4),
      isVerified: overrides.isVerified ?? true,
      status: overrides.status ?? UserStatus.ACTIVE,
      locale: overrides.locale ?? DEFAULT_LOCALE,
      roles: {
        create: roles.map((name) => ({
          role: { connectOrCreate: { where: { name }, create: { name } } },
        })),
      },
    },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    password,
    roles,
    accessToken: await app
      .get(JwtService)
      .signAsync({ sub: user.id, email: user.email, roles }),
  };
}

const SEED_EPOCH = Date.UTC(2026, 0, 1);
const seedDate = (i: number) => new Date(SEED_EPOCH + i * 86_400_000);

export async function seedUsers(
  app: INestApplication,
  count: number,
  prefix = 'user',
): Promise<{ id: string; email: string; name: string }[]> {
  const hashed = await bcrypt.hash('secret123', 4);
  const rows = Array.from({ length: count }, (_, i) => ({
    name: `${prefix} ${i + 1}`,
    email: `${prefix}${i + 1}@example.com`,
    password: hashed,
    isVerified: true,
    createdAt: seedDate(i),
    updatedAt: seedDate(i),
  }));

  await db(app).user.createMany({ data: rows });

  return db(app).user.findMany({
    where: { email: { in: rows.map((r) => r.email) } },
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
}

const hashToken = (raw: string) =>
  createHash('sha256').update(raw).digest('hex');

const randomToken = () => randomBytes(32).toString('hex');

export async function seedEmailVerificationToken(
  app: INestApplication,
  userId: string,
  options: { expiresAt?: Date; usedAt?: Date | null } = {},
): Promise<string> {
  const raw = randomToken();
  await db(app).emailVerificationToken.create({
    data: {
      userId,
      token: hashToken(raw),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 3_600_000),
      usedAt: options.usedAt ?? null,
    },
  });
  return raw;
}

export async function seedPasswordResetToken(
  app: INestApplication,
  userId: string,
  options: { expiresAt?: Date; usedAt?: Date | null } = {},
): Promise<string> {
  const raw = randomToken();
  await db(app).passwordResetToken.create({
    data: {
      userId,
      token: hashToken(raw),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 3_600_000),
      usedAt: options.usedAt ?? null,
    },
  });
  return raw;
}

export async function seedRefreshToken(
  app: INestApplication,
  userId: string,
  options: { expiresAt?: Date; revokedAt?: Date | null } = {},
): Promise<string> {
  const raw = randomToken();
  await db(app).refreshToken.create({
    data: {
      userId,
      token: hashToken(raw),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 86_400_000),
      revokedAt: options.revokedAt ?? null,
    },
  });
  return raw;
}

export function findRefreshToken(app: INestApplication, raw: string) {
  return db(app).refreshToken.findUnique({ where: { token: hashToken(raw) } });
}

export interface CapturedMail {
  event: string;
  email: string;
  name: string;
  token?: string;
  orderCode?: string;
  reason?: string;
  locale?: Locale;
}

export function captureMails(app: INestApplication): CapturedMail[] {
  const mails: CapturedMail[] = [];
  const emitter = app.get(EventEmitter2);
  for (const event of [
    ...Object.values(MailEvent),
    ...Object.values(OrderEvent),
  ]) {
    emitter.on(event, (payload: Omit<CapturedMail, 'event'>) => {
      mails.push({ event, ...payload });
    });
  }

  return mails;
}

export async function seedCategory(app: INestApplication, name = 'Đồ điện tử') {
  return db(app).category.create({ data: { name } });
}

export interface SeededProduct {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export async function seedProduct(
  app: INestApplication,
  overrides: {
    categoryId?: string;
    name?: string;
    price?: number;
    quantity?: number;
    status?: ProductStatus;
    isFeatured?: boolean;
    deletedAt?: Date | null;
  } = {},
): Promise<SeededProduct> {
  const categoryId =
    overrides.categoryId ??
    (await seedCategory(app, `Danh mục ${Date.now()}`)).id;

  const product = await db(app).product.create({
    data: {
      categoryId,
      name: overrides.name ?? 'Sản phẩm test',
      price: overrides.price ?? 100_000,
      quantity: overrides.quantity ?? 10,
      status: overrides.status ?? ProductStatus.ACTIVE,
      isFeatured: overrides.isFeatured ?? false,
      deletedAt: overrides.deletedAt ?? null,
    },
  });

  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    quantity: product.quantity,
  };
}

export async function stockOf(
  app: INestApplication,
  productId: string,
): Promise<number> {
  const product = await db(app).product.findUniqueOrThrow({
    where: { id: productId },
  });
  return product.quantity;
}

export const shippingInfo = {
  shippingName: 'Nguyen Van A',
  shippingPhone: '0912345678',
  shippingAddress: 'So 1, Ha Noi',
};

export interface OrderPayload {
  id: string;
  orderCode: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalAmount: number;
  items: {
    productId: string;
    productName: string;
    productPrice: number;
    quantity: number;
    subtotal: number;
  }[];
  cancelReason: string | null;
  rejectReason: string | null;
}

export interface CartPayload {
  items: {
    productId: string;
    name: string;
    price: number;
    quantity: number;
    subtotal: number;
    stock: number;
    available: boolean;
  }[];
  totalItems: number;
  totalQuantity: number;
  totalAmount: number;
}

export type CartBody = { cart: CartPayload };
export type OrderBody = { order: OrderPayload };
export type OrderListBody = {
  data: OrderPayload[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export async function expectOrderInvariants(
  app: INestApplication,
  orderId: string,
): Promise<void> {
  const order = await db(app).order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, payment: true },
  });

  for (const item of order.items) {
    expect(Number(item.subtotal)).toBe(
      Number(item.productPrice) * item.quantity,
    );
  }

  const sum = order.items.reduce((acc, item) => acc + Number(item.subtotal), 0);
  expect(Number(order.totalAmount)).toBe(sum);

  if (order.payment) {
    if (order.payment.status === PaymentStatus.PAID) {
      expect([OrderPaymentStatus.PAID, OrderPaymentStatus.REFUNDED]).toContain(
        order.paymentStatus,
      );
      expect(order.payment.paidAt).not.toBeNull();
    }
    if (order.payment.status === PaymentStatus.FAILED) {
      expect(order.paymentStatus).not.toBe(OrderPaymentStatus.PAID);
    }
  }
}

/* ----------------------------- ẢNH SẢN PHẨM ----------------------------- */

export async function seedProductImage(
  app: INestApplication,
  productId: string,
  overrides: {
    imageUrl?: string;
    sortOrder?: number;
    isPrimary?: boolean;
    deletedAt?: Date | null;
  } = {},
) {
  return db(app).image.create({
    data: {
      entityType: ImageEntityType.PRODUCT,
      entityId: productId,
      imageUrl: overrides.imageUrl ?? 'https://cdn.example.com/anh.jpg',
      sortOrder: overrides.sortOrder ?? 0,
      isPrimary: overrides.isPrimary ?? false,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

// Ảnh ĐANG HOẠT ĐỘNG của một sản phẩm (bỏ ảnh đã xoá mềm).
export async function activeImagesOf(app: INestApplication, productId: string) {
  return db(app).image.findMany({
    where: {
      entityType: ImageEntityType.PRODUCT,
      entityId: productId,
      deletedAt: null,
    },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
  });
}

/**
 * Bất biến của ảnh: có ảnh đang hoạt động thì phải có ĐÚNG một ảnh chính.
 *
 * DB đã có partial unique index chặn việc có HAI ảnh chính. Chốt còn thiếu là
 * chiều ngược lại — xoá ảnh chính mà không đề bạt ảnh khác sẽ để sản phẩm có
 * ảnh nhưng không ảnh nào là ảnh đại diện, DB không hề chặn.
 */
export async function expectExactlyOnePrimaryImage(
  app: INestApplication,
  productId: string,
): Promise<void> {
  const images = await activeImagesOf(app, productId);
  if (images.length === 0) return;

  expect(images.filter((image) => image.isPrimary)).toHaveLength(1);
}
