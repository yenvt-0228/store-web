import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { paginated } from '../common/dto/paginated-response.dto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';
import { ListSuggestionDto } from './dto/list-suggestion.dto';
import {
  suggestionInclude,
  toSuggestionResponse,
} from './dto/suggestion-response.dto';
import { UpdateSuggestionStatusDto } from './dto/update-suggestion-status.dto';

@Injectable()
export class ProductSuggestionService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  /**
   * @param userId - Người gửi yêu cầu.
   * @param dto - Tên, mô tả và link tham khảo.
   * @returns Yêu cầu vừa tạo, trạng thái PENDING.
   */
  async create(userId: string, dto: CreateSuggestionDto) {
    const suggestion = await this.prisma.productSuggestion.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description ?? null,
        referenceUrl: dto.referenceUrl ?? null,
      },
      include: suggestionInclude,
    });

    return toSuggestionResponse(suggestion, false);
  }

  /**
   * Yêu cầu của chính người đang đăng nhập.
   *
   * @param userId - Chủ các yêu cầu.
   * @param query - Trang và bộ lọc trạng thái.
   * @returns Một trang yêu cầu, mới nhất trước.
   */
  async findMine(userId: string, query: ListSuggestionDto) {
    return this.list({ userId, ...this.statusFilter(query) }, query, false);
  }

  /**
   * Toàn bộ yêu cầu, cho admin.
   *
   * @param query - Trang và bộ lọc trạng thái.
   * @returns Một trang yêu cầu, kèm người gửi.
   */
  async findAll(query: ListSuggestionDto) {
    return this.list(this.statusFilter(query), query, true);
  }

  /**
   * @param id - Yêu cầu cần xem.
   * @returns Chi tiết yêu cầu, kèm người gửi và người duyệt.
   * @throws {NotFoundException} Khi không có yêu cầu nào mang id đó.
   */
  async findOne(id: string) {
    return toSuggestionResponse(await this.getOrFail(id), true);
  }

  /**
   * Admin duyệt hoặc từ chối một yêu cầu.
   *
   * Không có máy trạng thái như đơn hàng: admin đổi qua lại giữa ba trạng thái
   * đều hợp lệ — duyệt nhầm thì phải sửa lại được.
   *
   * @param id - Yêu cầu cần xử lý.
   * @param adminId - Admin đang xử lý, lưu lại để có dấu vết.
   * @param dto - Trạng thái mới và ghi chú.
   * @returns Yêu cầu sau khi cập nhật.
   * @throws {NotFoundException} Khi không có yêu cầu nào mang id đó.
   */
  async updateStatus(
    id: string,
    adminId: string,
    dto: UpdateSuggestionStatusDto,
  ) {
    await this.getOrFail(id);

    const suggestion = await this.prisma.productSuggestion.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.note === undefined ? {} : { note: dto.note }),
        // Ghi lại ai xử lý và lúc nào, kể cả khi đưa về PENDING: "ai đã đụng
        // vào" mới là thứ cần khi có tranh cãi, không phải "ai đã duyệt".
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
      include: suggestionInclude,
    });

    return toSuggestionResponse(suggestion, true);
  }

  /**
   * @param where - Điều kiện lọc đã dựng sẵn.
   * @param query - Trang và số dòng.
   * @param forAdmin - Có kèm người gửi/người duyệt hay không.
   * @returns Một trang kết quả.
   */
  private async list(
    where: Prisma.ProductSuggestionWhereInput,
    query: ListSuggestionDto,
    forAdmin: boolean,
  ) {
    const { page = 1, limit = 10 } = query;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productSuggestion.findMany({
        where,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: suggestionInclude,
      }),
      this.prisma.productSuggestion.count({ where }),
    ]);

    return paginated(
      rows.map((row) => toSuggestionResponse(row, forAdmin)),
      total,
      page,
      limit,
    );
  }

  private statusFilter(query: ListSuggestionDto) {
    return query.status ? { status: query.status } : {};
  }

  /**
   * @param id - Yêu cầu cần đọc.
   * @throws {NotFoundException} Khi không có yêu cầu nào mang id đó.
   */
  private async getOrFail(id: string) {
    const suggestion = await this.prisma.productSuggestion.findUnique({
      where: { id },
      include: suggestionInclude,
    });

    if (!suggestion) {
      throw new NotFoundException(this.i18n.t('suggestion.NOT_FOUND'));
    }

    return suggestion;
  }
}
