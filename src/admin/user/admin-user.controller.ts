import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RoleName } from '../../common/constants/role.constant';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminUserService } from './admin-user.service';
import { ListUserDto } from './dto/list-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@ApiTags('admin/users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN)
@Controller('admin/users')
export class AdminUserController {
  constructor(private adminUserService: AdminUserService) {}

  @ApiOperation({
    summary: 'Danh sách user (tìm theo tên/email, lọc trạng thái)',
  })
  @Get()
  findAll(@Query() query: ListUserDto) {
    return this.adminUserService.findAll(query);
  }

  @ApiOperation({ summary: 'Chi tiết user' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { user: await this.adminUserService.findOne(id) };
  }

  @ApiOperation({ summary: 'Kích hoạt / khóa tài khoản user' })
  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return {
      user: await this.adminUserService.updateStatus(id, dto, admin.id),
    };
  }
}
