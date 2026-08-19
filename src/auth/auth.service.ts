import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { I18nService } from 'nestjs-i18n';
import { RoleName } from '../common/constants/role.constant';
import {
  toUserResponse,
  UserResponseDto,
} from '../common/dto/user-response.dto';
import {
  MailEvent,
  PasswordResetRequestedEvent,
  UserRegisteredEvent,
} from '../common/events/mail.event';
import {
  roleNamesOf,
  userWithRolesInclude,
  UserWithRoles,
} from '../common/types/user-with-roles';
import { UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenService } from './token.service';

const BCRYPT_ROUNDS = 10;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private i18n: I18nService,
    private tokens: TokenService,
    private events: EventEmitter2,
  ) {}

  async register(dto: RegisterDto): Promise<{
    user: UserResponseDto;
    message: string;
  }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException(this.i18n.t('auth.EMAIL_TAKEN'));
    }

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        roles: {
          create: {
            role: {
              connectOrCreate: {
                where: { name: RoleName.USER },
                create: { name: RoleName.USER, description: 'Người dùng' },
              },
            },
          },
        },
      },
      include: userWithRolesInclude,
    });

    const rawToken = await this.tokens.issueEmailVerificationToken(user.id);

    this.events.emit(MailEvent.USER_REGISTERED, {
      email: user.email,
      name: user.name,
      token: rawToken,
    } satisfies UserRegisteredEvent);

    return {
      user: toUserResponse(user),
      message: this.i18n.t('auth.REGISTERED'),
    };
  }

  async activate(dto: ActivateAccountDto): Promise<{ message: string }> {
    const userId = await this.tokens.consumeEmailVerificationToken(dto.token);

    await this.prisma.user.update({
      where: { id: userId },
      data: { isVerified: true },
    });

    return { message: this.i18n.t('auth.ACTIVATED') };
  }

  async login(
    dto: LoginDto,
  ): Promise<{ user: UserResponseDto; tokens: AuthTokens }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: userWithRolesInclude,
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException(this.i18n.t('auth.INVALID_CREDENTIALS'));
    }

    this.assertUserCanLogin(user);

    return {
      user: toUserResponse(user),
      tokens: await this.issueTokens(user),
    };
  }

  async refresh(dto: RefreshTokenDto): Promise<{ tokens: AuthTokens }> {
    const { userId, refreshToken } = await this.tokens.rotateRefreshToken(
      dto.refreshToken,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithRolesInclude,
    });
    if (!user) {
      throw new UnauthorizedException(this.i18n.t('auth.INVALID_TOKEN'));
    }

    this.assertUserCanLogin(user);

    return {
      tokens: {
        accessToken: await this.signAccessToken(user),
        refreshToken,
        tokenType: 'Bearer',
      },
    };
  }

  async logout(dto: RefreshTokenDto): Promise<{ message: string }> {
    await this.tokens.revokeRefreshToken(dto.refreshToken);
    return { message: this.i18n.t('auth.LOGGED_OUT') };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (user && user.status === UserStatus.ACTIVE) {
      const rawToken = await this.tokens.issuePasswordResetToken(user.id);
      this.events.emit(MailEvent.PASSWORD_RESET_REQUESTED, {
        email: user.email,
        name: user.name,
        token: rawToken,
      } satisfies PasswordResetRequestedEvent);
    }

    return { message: this.i18n.t('auth.RESET_LINK_SENT') };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const userId = await this.tokens.consumePasswordResetToken(dto.token);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(this.i18n.t('user.NOT_FOUND'));
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS) },
    });

    await this.tokens.revokeAllRefreshTokens(userId);

    this.events.emit(MailEvent.PASSWORD_CHANGED, {
      email: user.email,
      name: user.name,
    });

    return { message: this.i18n.t('auth.PASSWORD_RESET') };
  }

  private assertUserCanLogin(user: UserWithRoles): void {
    if (!user.isVerified) {
      throw new ForbiddenException(this.i18n.t('auth.NOT_VERIFIED'));
    }
    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException(this.i18n.t('auth.ACCOUNT_INACTIVE'));
    }
  }

  private async issueTokens(user: UserWithRoles): Promise<AuthTokens> {
    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: await this.tokens.issueRefreshToken(user.id),
      tokenType: 'Bearer',
    };
  }

  private signAccessToken(user: UserWithRoles): Promise<string> {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      roles: roleNamesOf(user),
    });
  }
}
