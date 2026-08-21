import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { paginated } from '../common/dto/paginated-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoryService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 10 } = query;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        skip: query.skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.category.count(),
    ]);
    return paginated(data, total, page, limit);
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException(this.i18n.t('category.NOT_FOUND'));
    }
    return category;
  }

  async create(dto: CreateCategoryDto) {
    await this.assertNameAvailable(dto.name);
    return this.prisma.category.create({ data: dto });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);
    if (dto.name) {
      await this.assertNameAvailable(dto.name, id);
    }
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    const productCount = await this.prisma.product.count({
      where: { categoryId: id },
    });
    if (productCount > 0) {
      throw new BadRequestException(this.i18n.t('category.HAS_PRODUCTS'));
    }

    await this.prisma.category.delete({ where: { id } });
    return { message: this.i18n.t('category.DELETED') };
  }

  private async assertNameAvailable(name: string, exceptId?: string) {
    const existing = await this.prisma.category.findUnique({ where: { name } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(this.i18n.t('category.NAME_TAKEN'));
    }
  }
}
