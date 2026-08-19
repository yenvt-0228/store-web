import { Expose, plainToInstance } from 'class-transformer';
import { UserStatus } from '../../generated/prisma/enums';
import { roleNamesOf, UserWithRoles } from '../types/user-with-roles';

export class UserResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() email: string;
  @Expose() phone: string | null;
  @Expose() address: string | null;
  @Expose() avatar: string | null;
  @Expose() status: UserStatus;
  @Expose() isVerified: boolean;
  @Expose() createdAt: Date;

  roles: string[];
}

export function toUserResponse(user: UserWithRoles): UserResponseDto {
  const dto = plainToInstance(UserResponseDto, user, {
    excludeExtraneousValues: true,
  });
  dto.roles = roleNamesOf(user);
  return dto;
}
