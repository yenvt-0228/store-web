import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { AdminOrderController } from './admin-order.controller';
import { AdminOrderService } from './admin-order.service';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

@Module({
  imports: [AuthModule, CartModule],
  controllers: [OrderController, AdminOrderController],
  providers: [OrderService, AdminOrderService],
  exports: [OrderService],
})
export class OrderModule {}
