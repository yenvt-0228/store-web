import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private cartService: CartService) {}

  @ApiOperation({ summary: 'Xem giỏ hàng' })
  @Get()
  async findAll(@CurrentUser() user: AuthUser) {
    return { cart: await this.cartService.getCart(user.id) };
  }

  @ApiOperation({ summary: 'Thêm sản phẩm vào giỏ' })
  @Post('items')
  async add(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto) {
    return { cart: await this.cartService.addItem(user.id, dto) };
  }

  @ApiOperation({ summary: 'Sửa số lượng (id = productId)' })
  @Patch('items/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return {
      cart: await this.cartService.updateItem(user.id, productId, dto.quantity),
    };
  }

  @ApiOperation({ summary: 'Xoá một sản phẩm khỏi giỏ' })
  @Delete('items/:id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) productId: string,
  ) {
    return { cart: await this.cartService.removeItem(user.id, productId) };
  }

  @ApiOperation({ summary: 'Xoá toàn bộ giỏ hàng' })
  @Delete()
  clear(@CurrentUser() user: AuthUser) {
    return this.cartService.clear(user.id);
  }
}
