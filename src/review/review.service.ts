import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { RoleName } from '../common/constants/role.constant';
import { paginated } from '../common/dto/paginated-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus, ProductStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import {
  ReviewSummaryDto,
  reviewInclude,
  toReviewResponse,
} from './dto/review-response.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

/**
 * Trạng thái đơn được tính là "đã mua".
 *
 * COMPLETED chứ không phải CONFIRMED: đơn đã xác nhận vẫn có thể bị huỷ hoặc
 * hoàn, và một đánh giá dựa trên hàng chưa tới tay thì không đánh giá cái gì
 * cả. Muốn nới lỏng thì sửa đúng một mảng này.
 */
const PURCHASED_STATUSES: OrderStatus[] = [OrderStatus.COMPLETED];

@Injectable()
export class ReviewService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  /**
   * Một trang đánh giá của sản phẩm, kèm điểm trung bình và phân bố sao.
   *
   * @param productId - Sản phẩm cần đọc đánh giá.
   * @param query - Trang và số dòng mỗi trang.
   * @returns Trang đánh giá, kèm `summary` tính trên TOÀN BỘ đánh giá.
   * @throws {NotFoundException} Khi sản phẩm không tồn tại hoặc không công khai.
   */
  async findAll(productId: string, query: PaginationDto) {
    await this.getPublicProduct(productId);

    const { page = 1, limit = 10 } = query;
    const [rows, total, summary] = await Promise.all([
      this.prisma.review.findMany({
        where: { productId },
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: reviewInclude,
      }),
      this.prisma.review.count({ where: { productId } }),
      this.summaryOf(productId),
    ]);

    return {
      ...paginated(rows.map(toReviewResponse), total, page, limit),
      // Trung bình của cả sản phẩm, không phải của trang đang xem: trang 2 mà
      // đổi số sao trung bình thì con số đó vô nghĩa.
      summary,
    };
  }

  /**
   * Điểm trung bình và số lượt theo từng mức sao.
   *
   * Tính khi đọc thay vì lưu sẵn `ratingAvg` trên Product: `groupBy` trên cột
   * đã đánh index là một query rẻ, còn cột lưu sẵn thì mọi đường ghi review đều
   * phải nhớ cập nhật, và quên một chỗ là số liệu sai vĩnh viễn mà không ai
   * biết. Nếu sau này cần `sort=rating_desc` thì mới đáng đổi.
   *
   * @param productId - Sản phẩm cần tổng hợp.
   * @returns Trung bình (làm tròn 1 chữ số), tổng lượt, và phân bố 1..5 sao.
   */
  async summaryOf(productId: string): Promise<ReviewSummaryDto> {
    const groups = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId },
      _count: { rating: true },
    });

    // Mức sao không ai chọn vẫn phải là 0, không phải thiếu khoá — client dựng
    // biểu đồ 5 cột không nên phải tự đoán cột nào vắng mặt.
    const breakdown: Record<string, number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };

    let total = 0;
    let sum = 0;

    for (const group of groups) {
      const count = group._count.rating;
      breakdown[String(group.rating)] = count;
      total += count;
      sum += group.rating * count;
    }

    return {
      average: total === 0 ? 0 : Math.round((sum / total) * 10) / 10,
      total,
      breakdown,
    };
  }

  /**
   * Tạo đánh giá cho một sản phẩm đã mua.
   *
   * @param userId - Người đánh giá.
   * @param productId - Sản phẩm được đánh giá.
   * @param dto - Số sao và nội dung.
   * @returns Đánh giá vừa tạo.
   * @throws {NotFoundException} Khi sản phẩm không tồn tại hoặc không công khai.
   * @throws {ForbiddenException} Khi người này chưa từng mua sản phẩm.
   * @throws {ConflictException} Khi người này đã đánh giá sản phẩm rồi.
   */
  async create(userId: string, productId: string, dto: CreateReviewDto) {
    await this.getPublicProduct(productId);
    await this.assertPurchased(userId, productId);

    try {
      const review = await this.prisma.review.create({
        data: {
          productId,
          userId,
          rating: dto.rating,
          content: dto.content ?? null,
        },
        include: reviewInclude,
      });

      return toReviewResponse(review);
    } catch (error) {
      // Không đọc-rồi-ghi để kiểm tra trùng: hai request song song của cùng một
      // người đều đọc thấy "chưa có" rồi cùng ghi. Unique index ở DB mới là thứ
      // chặn thật, và đây là chỗ dịch nó thành câu trả lời tử tế.
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(this.i18n.t('review.ALREADY_REVIEWED'));
      }
      throw error;
    }
  }

  /**
   * @param user - Người gọi, kèm vai trò.
   * @param id - Đánh giá cần sửa.
   * @param dto - Trường muốn đổi.
   * @returns Đánh giá sau khi sửa.
   */
  async update(
    user: { id: string; roles: string[] },
    id: string,
    dto: UpdateReviewDto,
  ) {
    await this.getOwnedReview(user, id);

    const review = await this.prisma.review.update({
      where: { id },
      data: {
        ...(dto.rating === undefined ? {} : { rating: dto.rating }),
        ...(dto.content === undefined ? {} : { content: dto.content }),
      },
      include: reviewInclude,
    });

    return toReviewResponse(review);
  }

  /**
   * @param user - Người gọi, kèm vai trò.
   * @param id - Đánh giá cần xoá.
   * @returns Thông báo đã xoá.
   */
  async remove(user: { id: string; roles: string[] }, id: string) {
    await this.getOwnedReview(user, id);

    // Xoá hẳn, không soft delete như Comment: đánh giá còn nằm đó là còn được
    // tính vào điểm trung bình, và ràng buộc "mỗi người một đánh giá" phải
    // nhả ra để người đó đánh giá lại được.
    await this.prisma.review.delete({ where: { id } });

    return { message: this.i18n.t('review.DELETED') };
  }

  /**
   * Đọc sản phẩm dưới góc nhìn của khách.
   *
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
   * Chốt "chỉ người đã mua mới được đánh giá".
   *
   * @param userId - Người đang đánh giá.
   * @param productId - Sản phẩm được đánh giá.
   * @throws {ForbiddenException} Khi không có đơn đã hoàn thành nào chứa sản phẩm này.
   */
  private async assertPurchased(userId: string, productId: string) {
    const purchased = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: { userId, status: { in: PURCHASED_STATUSES } },
      },
      select: { id: true },
    });

    if (!purchased) {
      throw new ForbiddenException(this.i18n.t('review.NOT_PURCHASED'));
    }
  }

  /**
   * Đọc đánh giá và chốt quyền sửa/xoá.
   *
   * ADMIN đi qua được vì phải dọn được nội dung bẩn; mọi người khác chỉ đụng
   * vào đánh giá của chính mình.
   *
   * @param user - Người gọi, kèm vai trò.
   * @param id - Đánh giá cần đụng tới.
   * @throws {NotFoundException} Khi không có đánh giá nào mang id đó.
   * @throws {ForbiddenException} Khi đánh giá thuộc về người khác.
   */
  private async getOwnedReview(
    user: { id: string; roles: string[] },
    id: string,
  ) {
    const review = await this.prisma.review.findUnique({ where: { id } });

    if (!review) {
      throw new NotFoundException(this.i18n.t('review.NOT_FOUND'));
    }

    if (review.userId !== user.id && !user.roles.includes(RoleName.ADMIN)) {
      throw new ForbiddenException(this.i18n.t('review.FORBIDDEN'));
    }

    return review;
  }

  /**
   * @param error - Lỗi Prisma ném ra.
   * @returns `true` khi đó là vi phạm ràng buộc unique (P2002).
   */
  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
