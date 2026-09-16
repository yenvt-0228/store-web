import { Prisma } from '../../generated/prisma/client';

export const suggestionInclude = {
  user: { select: { id: true, name: true, email: true } },
  reviewer: { select: { id: true, name: true } },
} satisfies Prisma.ProductSuggestionInclude;

type SuggestionPayload = Prisma.ProductSuggestionGetPayload<{
  include: typeof suggestionInclude;
}>;

/**
 * @param suggestion - Dòng đọc từ DB.
 * @param forAdmin - `true` thì kèm người gửi và người duyệt.
 * @returns Yêu cầu gợi ý ở dạng trả cho client.
 */
export function toSuggestionResponse(
  suggestion: SuggestionPayload,
  forAdmin: boolean,
) {
  return {
    id: suggestion.id,
    name: suggestion.name,
    description: suggestion.description,
    referenceUrl: suggestion.referenceUrl,
    status: suggestion.status,
    note: suggestion.note,
    createdAt: suggestion.createdAt,
    reviewedAt: suggestion.reviewedAt,
    // Email người gửi và danh tính người duyệt chỉ dành cho admin: khách xem
    // yêu cầu của chính mình thì đã biết mình là ai, còn biết admin nào duyệt
    // thì không.
    ...(forAdmin
      ? { user: suggestion.user, reviewer: suggestion.reviewer }
      : {}),
  };
}
