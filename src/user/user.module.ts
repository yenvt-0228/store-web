import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [AuthModule], // cần TokenService để thu hồi refresh token khi đổi mật khẩu
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
