import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { multiply, sum, toNumber } from '../common/utils/money.util';
import { ProductStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';

export interface CartItemView {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  stock: number;
  available: boolean;
}

export interface CartView {
  items: CartItemView[];
  totalItems: number;
  totalQuantity: number;
  totalAmount: number;
}

@Injectable()
export class CartService {
  private static readonly TTL_SECONDS = 30 * 24 * 60 * 60;

  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  private key(userId: string): string {
    return `cart:${userId}`;
  }

  private async client() {
    await this.redis.ensureConnected();
    return this.redis.client;
  }

  async getCart(userId: string): Promise<CartView> {
    const client = await this.client();
    const raw = await client.hgetall(this.key(userId));
    return this.buildView(raw);
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartView> {
    const client = await this.client();
    const key = this.key(userId);

    const current = Number((await client.hget(key, dto.productId)) ?? 0);
    const desired = current + dto.quantity;

    await this.assertPurchasable(dto.productId, desired);

    await client.hset(key, dto.productId, desired);
    await client.expire(key, CartService.TTL_SECONDS);

    return this.getCart(userId);
  }

  async updateItem(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<CartView> {
    const client = await this.client();
    const key = this.key(userId);

    const exists = await client.hexists(key, productId);
    if (!exists) {
      throw new NotFoundException(this.i18n.t('cart.ITEM_NOT_FOUND'));
    }

    await this.assertPurchasable(productId, quantity);

    await client.hset(key, productId, quantity);
    await client.expire(key, CartService.TTL_SECONDS);

    return this.getCart(userId);
  }

  async removeItem(userId: string, productId: string): Promise<CartView> {
    const client = await this.client();
    const removed = await client.hdel(this.key(userId), productId);
    if (removed === 0) {
      throw new NotFoundException(this.i18n.t('cart.ITEM_NOT_FOUND'));
    }
    return this.getCart(userId);
  }

  async clear(userId: string): Promise<{ message: string }> {
    const client = await this.client();
    await client.del(this.key(userId));
    return { message: this.i18n.t('cart.CLEARED') };
  }

  async removeItems(userId: string, productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    const client = await this.client();
    await client.hdel(this.key(userId), ...productIds);
  }

  private async assertPurchasable(productId: string, quantity: number) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: ProductStatus.ACTIVE, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException(this.i18n.t('product.NOT_FOUND'));
    }
    if (product.quantity < quantity) {
      throw new BadRequestException(
        this.i18n.t('cart.OUT_OF_STOCK', {
          args: { name: product.name, stock: product.quantity },
        }),
      );
    }
  }

  private async buildView(raw: Record<string, string>): Promise<CartView> {
    const productIds = Object.keys(raw);
    if (productIds.length === 0) {
      return { items: [], totalItems: 0, totalQuantity: 0, totalAmount: 0 };
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const items: CartItemView[] = productIds.map((productId) => {
      const product = byId.get(productId);
      const quantity = Number(raw[productId]);

      if (!product) {
        return {
          productId,
          name: this.i18n.t('cart.PRODUCT_UNAVAILABLE'),
          price: 0,
          quantity,
          subtotal: 0,
          stock: 0,
          available: false,
        };
      }

      return {
        productId,
        name: product.name,
        price: toNumber(product.price),
        quantity,
        subtotal: toNumber(multiply(product.price, quantity)),
        stock: product.quantity,
        available:
          product.status === ProductStatus.ACTIVE &&
          product.quantity >= quantity,
      };
    });

    const payable = items.filter((item) => item.available);

    return {
      items,
      totalItems: items.length,
      totalQuantity: payable.reduce((acc, item) => acc + item.quantity, 0),
      totalAmount: toNumber(
        sum(payable.map((item) => multiply(item.price, item.quantity))),
      ),
    };
  }
}
