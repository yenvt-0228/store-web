import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { paginated } from '../common/dto/paginated-response.dto';
import { Prisma } from '../generated/prisma/client';
import { ImageEntityType, ProductStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductDto, ProductSort } from './dto/list-product.dto';
import {
  ProductImageInputDto,
  UpdateProductImageDto,
} from './dto/product-image.dto';
import {
  ImageRow,
  productInclude,
  toProductResponse,
} from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const MAX_IMAGES_PER_PRODUCT = 10;

const IMAGE_ORDER = [
  { isPrimary: 'desc' as const },
  { sortOrder: 'asc' as const },
];

@Injectable()
export class ProductService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  async findAll(query: ListProductDto, publicOnly: boolean) {
    const where = this.buildWhere(query, publicOnly);
    const { page = 1, limit = 10 } = query;

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: query.skip,
        take: limit,
        orderBy: this.buildOrderBy(query.sort),
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);

    const images = await this.loadImages(products.map((p) => p.id));

    return paginated(
      products.map((product) =>
        toProductResponse(product, images.get(product.id) ?? []),
      ),
      total,
      page,
      limit,
    );
  }

  async findFeatured(limit = 8) {
    const products = await this.prisma.product.findMany({
      where: {
        isFeatured: true,
        status: ProductStatus.ACTIVE,
        deletedAt: null,
      },
      take: Math.min(limit, 50),
      orderBy: { createdAt: 'desc' },
      include: productInclude,
    });
    const images = await this.loadImages(products.map((p) => p.id));

    return {
      data: products.map((product) =>
        toProductResponse(product, images.get(product.id) ?? []),
      ),
    };
  }

  async findOne(id: string, publicOnly: boolean) {
    const product = await this.prisma.product.findFirst({
      where: publicOnly
        ? { id, status: ProductStatus.ACTIVE, deletedAt: null }
        : { id, deletedAt: null },
      include: productInclude,
    });
    if (!product) {
      throw new NotFoundException(this.i18n.t('product.NOT_FOUND'));
    }
    return toProductResponse(product, await this.imagesOf(id));
  }

  async create(dto: CreateProductDto) {
    await this.assertCategoryExists(dto.categoryId);

    const { images, ...data } = dto;

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data,
        include: productInclude,
      });

      if (images?.length) {
        await tx.image.createMany({
          data: this.buildImageRows(images).map((row) => ({
            ...row,
            entityType: ImageEntityType.PRODUCT,
            entityId: created.id,
          })),
        });
      }

      return created;
    });

    return toProductResponse(product, await this.imagesOf(product.id));
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id, false);
    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    const { images, ...data } = dto;
    void images;

    const product = await this.prisma.product.update({
      where: { id },
      data,
      include: productInclude,
    });
    return toProductResponse(product, await this.imagesOf(id));
  }

  /*  ẢNH  */

  async addImages(productId: string, images: ProductImageInputDto[]) {
    await this.findOne(productId, false);

    const active = await this.prisma.image.count({
      where: this.imageScope(productId),
    });
    if (active + images.length > MAX_IMAGES_PER_PRODUCT) {
      throw new BadRequestException(
        this.i18n.t('product.IMAGE_LIMIT', {
          args: { max: MAX_IMAGES_PER_PRODUCT },
        }),
      );
    }

    const hasPrimary =
      (await this.prisma.image.count({
        where: { ...this.imageScope(productId), isPrimary: true },
      })) > 0;

    const rows = this.buildImageRows(images, { keepPrimarySlot: !hasPrimary });

    await this.prisma.$transaction(async (tx) => {
      if (rows.some((row) => row.isPrimary) && hasPrimary) {
        await tx.image.updateMany({
          where: { ...this.imageScope(productId), isPrimary: true },
          data: { isPrimary: false },
        });
      }
      await tx.image.createMany({
        data: rows.map((row) => ({
          ...row,
          entityType: ImageEntityType.PRODUCT,
          entityId: productId,
        })),
      });
    });

    return this.findOne(productId, false);
  }

  async updateImage(
    productId: string,
    imageId: string,
    dto: UpdateProductImageDto,
  ) {
    await this.assertImageBelongsToProduct(productId, imageId);

    await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await tx.image.updateMany({
          where: {
            ...this.imageScope(productId),
            isPrimary: true,
            id: { not: imageId },
          },
          data: { isPrimary: false },
        });
      }
      await tx.image.update({ where: { id: imageId }, data: dto });
    });

    return this.findOne(productId, false);
  }

  async removeImage(productId: string, imageId: string) {
    const image = await this.assertImageBelongsToProduct(productId, imageId);

    await this.prisma.$transaction(async (tx) => {
      await tx.image.update({
        where: { id: imageId },
        data: { deletedAt: new Date(), isPrimary: false },
      });

      if (image.isPrimary) {
        const next = await tx.image.findFirst({
          where: this.imageScope(productId),
          orderBy: { sortOrder: 'asc' },
        });
        if (next) {
          await tx.image.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
        }
      }
    });

    return { message: this.i18n.t('product.IMAGE_DELETED') };
  }

  async remove(id: string) {
    await this.findOne(id, false);

    const deletedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id },
        data: { deletedAt, status: ProductStatus.INACTIVE },
      }),
      this.prisma.image.updateMany({
        where: this.imageScope(id),
        data: { deletedAt, isPrimary: false },
      }),
    ]);

    return { message: this.i18n.t('product.DELETED') };
  }

  private buildWhere(
    query: ListProductDto,
    publicOnly: boolean,
  ): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { deletedAt: null };

    if (publicOnly) {
      where.status = ProductStatus.ACTIVE;
    } else if (query.status) {
      where.status = query.status;
    }

    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.isFeatured !== undefined) {
      where.isFeatured = query.isFeatured;
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    return where;
  }

  private buildOrderBy(
    sort?: ProductSort,
  ): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case 'oldest':
        return { createdAt: 'asc' };
      case 'price_asc':
        return { price: 'asc' };
      case 'price_desc':
        return { price: 'desc' };
      case 'name_asc':
        return { name: 'asc' };
      default:
        return { createdAt: 'desc' };
    }
  }

  private buildImageRows(
    images: ProductImageInputDto[],
    options: { keepPrimarySlot?: boolean } = {},
  ) {
    const { keepPrimarySlot = true } = options;
    const firstRequested = images.findIndex((image) => image.isPrimary);
    const primaryIndex = keepPrimarySlot
      ? firstRequested === -1
        ? 0
        : firstRequested
      : firstRequested;

    return images.map((image, index) => ({
      imageUrl: image.imageUrl,
      sortOrder: image.sortOrder ?? index,
      isPrimary: index === primaryIndex,
    }));
  }

  private imageScope(productId: string) {
    return {
      entityType: ImageEntityType.PRODUCT,
      entityId: productId,
      deletedAt: null,
    };
  }

  private async imagesOf(productId: string): Promise<ImageRow[]> {
    return this.prisma.image.findMany({
      where: this.imageScope(productId),
      orderBy: IMAGE_ORDER,
    });
  }

  private async loadImages(
    productIds: string[],
  ): Promise<Map<string, ImageRow[]>> {
    const grouped = new Map<string, ImageRow[]>();
    if (productIds.length === 0) return grouped;

    const images = await this.prisma.image.findMany({
      where: {
        entityType: ImageEntityType.PRODUCT,
        entityId: { in: productIds },
        deletedAt: null,
      },
      orderBy: IMAGE_ORDER,
    });

    for (const image of images) {
      const list = grouped.get(image.entityId) ?? [];
      list.push(image);
      grouped.set(image.entityId, list);
    }

    return grouped;
  }

  private async assertImageBelongsToProduct(
    productId: string,
    imageId: string,
  ) {
    const image = await this.prisma.image.findFirst({
      where: { ...this.imageScope(productId), id: imageId },
    });

    if (!image) {
      throw new NotFoundException(this.i18n.t('product.IMAGE_NOT_FOUND'));
    }
    return image;
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException(this.i18n.t('category.NOT_FOUND'));
    }
  }
}
