import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { I18nService } from 'nestjs-i18n';
import type { AuthUser } from '../../auth/current-user.decorator';
import { RoleName } from '../constants/role.constant';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const i18n = { t: (key: string) => key } as unknown as I18nService;

  const contextWith = (user?: Partial<AuthUser>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector, i18n);
  });

  const requireRoles = (roles: RoleName[] | undefined) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  it('route không khai báo @Roles -> cho qua', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextWith({ roles: [] }))).toBe(true);
  });

  it('@Roles rỗng -> cho qua', () => {
    requireRoles([]);
    expect(guard.canActivate(contextWith({ roles: [] }))).toBe(true);
  });

  it('user có đúng role yêu cầu -> cho qua', () => {
    requireRoles([RoleName.ADMIN]);
    expect(guard.canActivate(contextWith({ roles: ['ADMIN'] }))).toBe(true);
  });

  it('user có MỘT trong nhiều role yêu cầu -> cho qua', () => {
    requireRoles([RoleName.ADMIN, RoleName.USER]);
    expect(guard.canActivate(contextWith({ roles: ['USER'] }))).toBe(true);
  });

  it('user thiếu role -> ForbiddenException', () => {
    requireRoles([RoleName.ADMIN]);
    expect(() => guard.canActivate(contextWith({ roles: ['USER'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('chưa đăng nhập (thiếu req.user) -> UnauthorizedException', () => {
    requireRoles([RoleName.ADMIN]);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
