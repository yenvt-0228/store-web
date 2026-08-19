import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { I18nService } from 'nestjs-i18n';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  roleNamesOf,
  userWithRolesInclude,
} from '../common/types/user-with-roles';
import { UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './current-user.decorator';

interface JwtPayload {
  sub: string; // id user (UUID)
  email: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: userWithRolesInclude,
    });

    if (!user) {
      throw new UnauthorizedException(this.i18n.t('auth.UNAUTHORIZED'));
    }
    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException(this.i18n.t('auth.ACCOUNT_INACTIVE'));
    }
    if (!user.isVerified) {
      throw new ForbiddenException(this.i18n.t('auth.NOT_VERIFIED'));
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, roles, ...rest } = user;
    return { ...rest, roles: roleNamesOf(user) };
  }
}
