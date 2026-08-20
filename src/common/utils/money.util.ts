import { Prisma } from '../../generated/prisma/client';

export type Money = Prisma.Decimal;

export function decimal(value: Prisma.Decimal | number | string): Money {
  return new Prisma.Decimal(value);
}

export function multiply(
  price: Money | number | string,
  quantity: number,
): Money {
  return decimal(price).mul(quantity);
}

export function sum(values: Money[]): Money {
  return values.reduce<Money>((acc, value) => acc.add(value), decimal(0));
}

// response
export function toNumber(value: Prisma.Decimal | number | string): number {
  return decimal(value).toNumber();
}
