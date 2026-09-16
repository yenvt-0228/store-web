import { Prisma } from '../../generated/prisma/client';

// Người viết hiện ra kèm đánh giá, nhưng chỉ id + tên: email là dữ liệu cá nhân
// và trang đánh giá thì ai cũng đọc được.
export const reviewInclude = {
  user: { select: { id: true, name: true, avatar: true } },
} satisfies Prisma.ReviewInclude;

type ReviewPayload = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

export class ReviewSummaryDto {
  average: number;
  total: number;
  /** Số lượt theo từng mức sao, khoá "1".."5" — dựng biểu đồ phân bố. */
  breakdown: Record<string, number>;
}

export function toReviewResponse(review: ReviewPayload) {
  return {
    id: review.id,
    productId: review.productId,
    rating: review.rating,
    content: review.content,
    user: review.user,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}
