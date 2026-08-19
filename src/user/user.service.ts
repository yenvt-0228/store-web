import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { I18nService } from 'nestjs-i18n';
import { TokenService } from '../auth/token.service';
import {
  toUserResponse,
  UserResponseDto,
} from '../common/dto/user-response.dto';
import { MailEvent } from '../common/events/mail.event';
import { userWithRolesInclude } from '../common/types/user-with-roles';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
    private tokens: TokenService,
    private events: EventEmitter2,
  ) {}

  async findMe(userId: string): Promise<UserResponseDto> {
    return toUserResponse(await this.getUserOrFail(userId));
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    await this.getUserOrFail(userId);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: dto, // DTO đã lọc field lạ (whitelist ở I18nValidationPipe)
      include: userWithRolesInclude,
    });

    return toUserResponse(updated);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.getUserOrFail(userId);

    if (!(await bcrypt.compare(dto.oldPassword, user.password))) {
      throw new BadRequestException(this.i18n.t('user.WRONG_OLD_PASSWORD'));
    }

    // Chặn đổi sang đúng mật khẩu đang dùng — đổi mà không thay đổi gì là vô nghĩa.
    if (await bcrypt.compare(dto.newPassword, user.password)) {
      throw new BadRequestException(this.i18n.t('user.SAME_PASSWORD'));
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS) },
    });

    // Buộc đăng nhập lại trên mọi thiết bị sau khi đổi mật khẩu.
    await this.tokens.revokeAllRefreshTokens(userId);

    this.events.emit(MailEvent.PASSWORD_CHANGED, {
      email: user.email,
      name: user.name,
    });

    return { message: this.i18n.t('user.PASSWORD_CHANGED') };
  }

  private async getUserOrFail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithRolesInclude,
    });
    if (!user) {
      throw new NotFoundException(this.i18n.t('user.NOT_FOUND'));
    }
    return user;
  }
}
