import { PickType } from '@nestjs/swagger';
import { UpdateProfileDto } from '../../../user/dto/update-profile.dto';

export class AdminUpdateUserDto extends PickType(UpdateProfileDto, [
  'name',
  'phone',
  'address',
  'locale',
] as const) {}
