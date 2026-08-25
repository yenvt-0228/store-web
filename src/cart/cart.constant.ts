export const MAX_QUANTITY_PER_ITEM = 99;

export const CartItemIssue = {
  DELETED: 'DELETED',
  INACTIVE: 'INACTIVE',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
} as const;

export type CartItemIssue = (typeof CartItemIssue)[keyof typeof CartItemIssue];
