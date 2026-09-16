import { Prisma } from '../../generated/prisma/client';

// Chỉ id, tên và ảnh đại diện của người viết: email là dữ liệu cá nhân, mà
// trang bình luận thì khách chưa đăng nhập cũng đọc được.
export const commentInclude = {
  user: { select: { id: true, name: true, avatar: true } },
} satisfies Prisma.CommentInclude;

type CommentPayload = Prisma.CommentGetPayload<{
  include: typeof commentInclude;
}>;

export function toCommentResponse(comment: CommentPayload) {
  return {
    id: comment.id,
    productId: comment.productId,
    content: comment.content,
    user: comment.user,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}
