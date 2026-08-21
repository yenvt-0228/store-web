import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { paginated } from '../common/dto/paginated-response.dto';
import { Prisma } from '../generated/prisma/client';
import { ProductStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductDto, ProductSort } from './dto/list-product.dto';
import { productInclude, toProductResponse } from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';

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

    return paginated(products.map(toProductResponse), total, page, limit);
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
    return { data: products.map(toProductResponse) };
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
    return toProductResponse(product);
  }

  async create(dto: CreateProductDto) {
    await this.assertCategoryExists(dto.categoryId);
    const product = await this.prisma.product.create({
      data: dto,
      include: productInclude,
    });
    return toProductResponse(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id, false);
    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }
    const product = await this.prisma.product.update({
      where: { id },
      data: dto,
      include: productInclude,
    });
    return toProductResponse(product);
  }

  async remove(id: string) {
    await this.findOne(id, false);
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: ProductStatus.INACTIVE },
    });
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

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException(this.i18n.t('category.NOT_FOUND'));
    }
  }
}
