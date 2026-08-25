import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { MockCallbackDto } from './dto/mock-callback.dto';
import { PaymentService } from './payment.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  @ApiOperation({ summary: 'Tạo thanh toán cho đơn hàng' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.paymentService.create(user.id, dto);
  }

  @ApiOperation({ summary: 'Cổng giả lập báo kết quả (thay cho webhook thật)' })
  @HttpCode(HttpStatus.OK)
  @Post('mock-callback')
  handleCallback(@Body() dto: MockCallbackDto) {
    return this.paymentService.handleCallback(dto);
  }

  @ApiOperation({ summary: 'Trạng thái thanh toán của đơn hàng' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':orderId')
  findByOrder(
    @CurrentUser() user: AuthUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.paymentService.findByOrder(user.id, orderId);
  }
}
