import { toNumber } from '../../common/utils/money.util';
import { Prisma } from '../../generated/prisma/client';
import { ProductStatus } from '../../generated/prisma/enums';
import { ProductImageResponseDto } from './product-image.dto';

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
  images: ProductImageResponseDto[];
  primaryImage: string | null;
  createdAt: Date;
}

export const productInclude = {
  category: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductWithCategory = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

export interface ImageRow {
  id: string;
  imageUrl: string;
  sortOrder: number;
  isPrimary: boolean;
}

export function toProductResponse(
  product: ProductWithCategory,
  images: ImageRow[] = [],
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
    images: images.map((image) => ({
      id: image.id,
      imageUrl: image.imageUrl,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),
    primaryImage: images.find((image) => image.isPrimary)?.imageUrl ?? null,
    createdAt: product.createdAt,
  };
}
