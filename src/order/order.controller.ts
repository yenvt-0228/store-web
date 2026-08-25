import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrderDto } from './dto/list-order.dto';
import { OrderService } from './order.service';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderController {
  constructor(private orderService: OrderService) {}

  @ApiOperation({ summary: 'Đặt hàng (từ giỏ, hoặc mua ngay khi gửi items)' })
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return { order: await this.orderService.create(user.id, dto) };
  }

  @ApiOperation({ summary: 'Lịch sử đơn hàng của tôi' })
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListOrderDto) {
    return this.orderService.findAll(user.id, query);
  }

  @ApiOperation({ summary: 'Chi tiết đơn hàng' })
  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { order: await this.orderService.findOne(user.id, id) };
  }

  @ApiOperation({ summary: 'Huỷ đơn (chỉ khi admin chưa xác nhận)' })
  @Patch(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return { order: await this.orderService.cancel(user.id, id, dto) };
  }
}
