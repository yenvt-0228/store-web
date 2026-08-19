import { Prisma } from '../../generated/prisma/client';

export const userWithRolesInclude = {
  roles: { include: { role: true } },
} satisfies Prisma.UserInclude;

export type UserWithRoles = Prisma.UserGetPayload<{
  include: typeof userWithRolesInclude;
}>;

export function roleNamesOf(user: UserWithRoles): string[] {
  return user.roles.map((userRole) => userRole.role.name);
}
