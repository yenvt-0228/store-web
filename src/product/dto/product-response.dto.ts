import { toNumber } from '../../common/utils/money.util';
import { Prisma } from '../../generated/prisma/client';
import { ProductStatus } from '../../generated/prisma/enums';

export class ProductResponseDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantity: number;
  inStock: boolean;
  status: ProductStatus;
  isFeatured: boolean;
  category: { id: string; name: string } | null;
  createdAt: Date;
}

type ProductWithCategory = Prisma.ProductGetPayload<{
  include: { category: { select: { id: true; name: true } } };
}>;

export const productInclude = {
  category: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

export function toProductResponse(
  product: ProductWithCategory,
): ProductResponseDto {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: toNumber(product.price),
    quantity: product.quantity,
    inStock: product.quantity > 0,
    status: product.status,
    isFeatured: product.isFeatured,
    category: product.category
      ? { id: product.category.id, name: product.category.name }
      : null,
    createdAt: product.createdAt,
  };
}
