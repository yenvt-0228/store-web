import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../generated/prisma/client';

export type AuthUser = Omit<User, 'password'> & { roles: string[] };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
