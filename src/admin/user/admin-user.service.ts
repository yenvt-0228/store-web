import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { TokenService } from '../../auth/token.service';
import {
  paginated,
  PaginatedResponseDto,
} from '../../common/dto/paginated-response.dto';
import {
  toUserResponse,
  UserResponseDto,
} from '../../common/dto/user-response.dto';
import { userWithRolesInclude } from '../../common/types/user-with-roles';
import { Prisma } from '../../generated/prisma/client';
import { UserStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { ListUserDto } from './dto/list-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Injectable()
export class AdminUserService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
    private tokens: TokenService,
  ) {}

  async findAll(
    query: ListUserDto,
  ): Promise<PaginatedResponseDto<UserResponseDto>> {
    const where = this.buildWhere(query);
    const { page = 1, limit = 10 } = query;
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: userWithRolesInclude,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginated(users.map(toUserResponse), total, page, limit);
  }

  async findOne(id: string): Promise<UserResponseDto> {
    return toUserResponse(await this.getUserOrFail(id));
  }

  async update(id: string, dto: AdminUpdateUserDto): Promise<UserResponseDto> {
    await this.getUserOrFail(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: dto, // DTO đã lọc field lạ (whitelist ở I18nValidationPipe)
      include: userWithRolesInclude,
    });

    return toUserResponse(updated);
  }

  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    currentAdminId: string,
  ): Promise<UserResponseDto> {
    if (id === currentAdminId && dto.status === UserStatus.INACTIVE) {
      throw new BadRequestException(
        this.i18n.t('admin.CANNOT_DEACTIVATE_SELF'),
      );
    }

    await this.getUserOrFail(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
      include: userWithRolesInclude,
    });

    if (dto.status === UserStatus.INACTIVE) {
      await this.tokens.revokeAllRefreshTokens(id);
    }

    return toUserResponse(updated);
  }

  private buildWhere(query: ListUserDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { email: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    if (query.status) {
      where.status = query.status;
    }

    return where;
  }

  private async getUserOrFail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userWithRolesInclude,
    });
    if (!user) {
      throw new NotFoundException(this.i18n.t('user.NOT_FOUND'));
    }
    return user;
  }
}
