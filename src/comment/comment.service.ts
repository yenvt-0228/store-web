import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { RoleName } from '../common/constants/role.constant';
import { paginated } from '../common/dto/paginated-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ProductStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { commentInclude, toCommentResponse } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Injectable()
export class CommentService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  /**
   * Một trang bình luận của sản phẩm, mới nhất trước.
   *
   * @param productId - Sản phẩm cần đọc bình luận.
   * @param query - Trang và số dòng mỗi trang.
   * @returns Trang bình luận.
   * @throws {NotFoundException} Khi sản phẩm không tồn tại hoặc không công khai.
   */
  async findAll(productId: string, query: PaginationDto) {
    await this.getPublicProduct(productId);

    const where = { productId, deletedAt: null };
    const { page = 1, limit = 10 } = query;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: commentInclude,
      }),
      this.prisma.comment.count({ where }),
    ]);

    return paginated(rows.map(toCommentResponse), total, page, limit);
  }

  /**
   * @param userId - Người bình luận.
   * @param productId - Sản phẩm được bình luận.
   * @param dto - Nội dung.
   * @returns Bình luận vừa tạo.
   * @throws {NotFoundException} Khi sản phẩm không tồn tại hoặc không công khai.
   */
  async create(userId: string, productId: string, dto: CreateCommentDto) {
    await this.getPublicProduct(productId);

    // Không chặn bình luận trùng và không bắt phải mua hàng: bình luận là chỗ
    // hỏi han trước khi mua, khác hẳn đánh giá — ai đọc được sản phẩm thì hỏi
    // được về nó.
    const comment = await this.prisma.comment.create({
      data: { productId, userId, content: dto.content },
      include: commentInclude,
    });

    return toCommentResponse(comment);
  }

  /**
   * @param user - Người gọi, kèm vai trò.
   * @param id - Bình luận cần sửa.
   * @param dto - Nội dung mới.
   * @returns Bình luận sau khi sửa.
   */
  async update(
    user: { id: string; roles: string[] },
    id: string,
    dto: UpdateCommentDto,
  ) {
    await this.getOwnedComment(user, id);

    const comment = await this.prisma.comment.update({
      where: { id },
      data: {
        ...(dto.content === undefined ? {} : { content: dto.content }),
      },
      include: commentInclude,
    });

    return toCommentResponse(comment);
  }

  /**
   * @param user - Người gọi, kèm vai trò.
   * @param id - Bình luận cần xoá.
   * @returns Thông báo đã xoá.
   */
  async remove(user: { id: string; roles: string[] }, id: string) {
    await this.getOwnedComment(user, id);

    // Soft delete, khác Review: một bình luận bị ADMIN gỡ là chứng cứ cho khiếu
    // nại về sau, và nó không được tính vào con số nào nên để lại không méo dữ
    // liệu. Đánh giá thì ngược lại — xem ReviewService.remove.
    await this.prisma.comment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { message: this.i18n.t('comment.DELETED') };
  }

  /**
   * @param productId - Sản phẩm cần kiểm tra.
   * @throws {NotFoundException} Khi sản phẩm không tồn tại, đã ẩn, hoặc đã xoá.
   */
  private async getPublicProduct(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: ProductStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException(this.i18n.t('product.NOT_FOUND'));
    }

    return product;
  }

  /**
   * Đọc bình luận và chốt quyền sửa/xoá.
   *
   * @param user - Người gọi, kèm vai trò.
   * @param id - Bình luận cần đụng tới.
   * @throws {NotFoundException} Khi không có bình luận nào mang id đó, hoặc nó đã bị xoá.
   * @throws {ForbiddenException} Khi bình luận thuộc về người khác.
   */
  private async getOwnedComment(
    user: { id: string; roles: string[] },
    id: string,
  ) {
    // deletedAt: null nằm trong điều kiện tìm — bình luận đã xoá phải là 404,
    // không phải một thứ xoá được lần thứ hai.
    const comment = await this.prisma.comment.findFirst({
      where: { id, deletedAt: null },
    });

    if (!comment) {
      throw new NotFoundException(this.i18n.t('comment.NOT_FOUND'));
    }

    if (comment.userId !== user.id && !user.roles.includes(RoleName.ADMIN)) {
      throw new ForbiddenException(this.i18n.t('comment.FORBIDDEN'));
    }

    return comment;
  }
}
