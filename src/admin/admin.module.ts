import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminUserController } from './user/admin-user.controller';
import { AdminUserService } from './user/admin-user.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminUserController],
  providers: [AdminUserService],
})
export class AdminModule {}
