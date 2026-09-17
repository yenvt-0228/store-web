import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppRole, resolveAppRole } from '../common/app-role';
import { registerOnce } from '../common/utils/dynamic-module.util';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { WsAuthService } from './ws-auth.service';

/**
 * Chat khách ↔ admin: REST để ghi, WebSocket để đẩy.
 *
 * Không đăng ký ở process worker, cùng lý do với GrpcModule: worker chạy
 * `createApplicationContext` nên không mở cổng nào, và một gateway ở đó là thứ
 * không ai kết nối tới được.
 */
@Module({})
export class ChatModule {
  static readonly register = registerOnce((): DynamicModule => {
    if (resolveAppRole() === AppRole.WORKER) {
      return { module: ChatModule };
    }

    return {
      module: ChatModule,
      imports: [AuthModule],
      controllers: [ChatController],
      providers: [ChatService, ChatGateway, WsAuthService],
      exports: [ChatService],
    };
  });
}
