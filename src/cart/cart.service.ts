import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { multiply, sum, toNumber } from '../common/utils/money.util';
import { ProductStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CartItemIssue, MAX_QUANTITY_PER_ITEM } from './cart.constant';
import { AddCartItemDto } from './dto/add-cart-item.dto';

export interface CartItemView {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  stock: number;
  available: boolean;
  reason: CartItemIssue | null;
}

export interface CartView {
  items: CartItemView[];
  totalItems: number;
  totalQuantity: number;
  totalAmount: number;
}

// Cộng dồn + kiểm hạn mức + đặt TTL trong một lệnh nguyên tử.
// Trả về [1, tổng mới] nếu đã ghi, [0, tổng bị từ chối] nếu vượt hạn mức.
const ADD_ITEM_SCRIPT = `
local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
local desired = current + tonumber(ARGV[2])
if desired > tonumber(ARGV[3]) then
  return {0, desired}
end
redis.call('HSET', KEYS[1], ARGV[1], desired)
redis.call('EXPIRE', KEYS[1], ARGV[4])
return {1, desired}
`;

@Injectable()
export class CartService {
  private static readonly TTL_SECONDS = 30 * 24 * 60 * 60;

  private readonly logger = new Logger(CartService.name);

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
    const key = this.key(userId);

    const results = await client
      .pipeline()
      .hgetall(key)
      .expire(key, CartService.TTL_SECONDS)
      .exec();

    const read = results?.[0];
    const touch = results?.[1];

    if (!read || read[0]) {
      throw new ServiceUnavailableException(read?.[0]?.message);
    }

    if (touch?.[0]) {
      this.logger.warn(
        `Không gia hạn được TTL cho ${key}: ${touch[0].message}`,
      );
    }

    return this.buildView(read[1] as Record<string, string>);
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartView> {
    const client = await this.client();
    const key = this.key(userId);

    const product = await this.findPurchasable(dto.productId);
    const limit = Math.min(product.quantity, MAX_QUANTITY_PER_ITEM);

    const [applied, desired] = (await client.eval(
      ADD_ITEM_SCRIPT,
      1,
      key,
      dto.productId,
      dto.quantity,
      limit,
      CartService.TTL_SECONDS,
    )) as [number, number];

    if (!applied) {
      throw this.limitError(product, desired);
    }

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

    const product = await this.findPurchasable(productId);
    if (quantity > product.quantity) {
      throw this.limitError(product, quantity);
    }

    await client
      .multi()
      .hset(key, productId, quantity)
      .expire(key, CartService.TTL_SECONDS)
      .exec();

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
    const key = this.key(userId);

    await client
      .multi()
      .hdel(key, ...productIds)
      .expire(key, CartService.TTL_SECONDS)
      .exec();
  }

  private limitError(
    product: { name: string; quantity: number },
    desired: number,
  ) {
    if (desired > MAX_QUANTITY_PER_ITEM) {
      return new BadRequestException(
        this.i18n.t('cart.MAX_QUANTITY', {
          args: { max: MAX_QUANTITY_PER_ITEM },
        }),
      );
    }

    return new BadRequestException(
      this.i18n.t('cart.OUT_OF_STOCK', {
        args: { name: product.name, stock: product.quantity },
      }),
    );
  }

  private async findPurchasable(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: ProductStatus.ACTIVE, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException(this.i18n.t('product.NOT_FOUND'));
    }

    return product;
  }

  private issueOf(
    product: { status: ProductStatus; quantity: number },
    quantity: number,
  ): CartItemIssue | null {
    if (product.status !== ProductStatus.ACTIVE) {
      return CartItemIssue.INACTIVE;
    }
    if (product.quantity < quantity) {
      return CartItemIssue.INSUFFICIENT_STOCK;
    }
    return null;
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
          reason: CartItemIssue.DELETED,
        };
      }

      const reason = this.issueOf(product, quantity);

      return {
        productId,
        name: product.name,
        price: toNumber(product.price),
        quantity,
        subtotal: toNumber(multiply(product.price, quantity)),
        stock: product.quantity,
        available: reason === null,
        reason,
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
