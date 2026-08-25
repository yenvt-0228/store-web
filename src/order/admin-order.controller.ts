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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleName } from '../common/constants/role.constant';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrderService } from './admin-order.service';
import { ListOrderDto } from './dto/list-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@ApiTags('admin/orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN)
@Controller('admin/orders')
export class AdminOrderController {
  constructor(private adminOrderService: AdminOrderService) {}

  @ApiOperation({
    summary: 'Danh sách đơn hàng (lọc trạng thái, tìm khách/mã đơn)',
  })
  @Get()
  findAll(@Query() query: ListOrderDto) {
    return this.adminOrderService.findAll(query);
  }

  @ApiOperation({ summary: 'Chi tiết đơn hàng' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { order: await this.adminOrderService.findOne(id) };
  }

  @ApiOperation({
    summary: 'Cập nhật trạng thái (xác nhận / từ chối kèm lý do)',
  })
  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return { order: await this.adminOrderService.updateStatus(id, dto) };
  }
}
