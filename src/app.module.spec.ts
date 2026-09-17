import { DynamicModule } from '@nestjs/common';
import { ChatModule } from './chat/chat.module';
import { GrpcModule } from './grpc/grpc.module';
import { KafkaModule } from './kafka/kafka.module';
import { MailModule } from './mail/mail.module';
import { QueueModule } from './queue/queue.module';
import { ReportModule } from './report/report.module';
import { TasksModule } from './tasks/tasks.module';

/** Mọi module động mà AppModule đăng ký. */
const DYNAMIC_MODULES: [string, () => DynamicModule][] = [
  ['QueueModule', () => QueueModule.register()],
  ['KafkaModule', () => KafkaModule.register()],
  ['GrpcModule', () => GrpcModule.register()],
  ['MailModule', () => MailModule.register()],
  ['ChatModule', () => ChatModule.register()],
  ['ReportModule', () => ReportModule.register()],
  ['TasksModule', () => TasksModule.register()],
];

describe('Module động phải trả về cùng một tham chiếu', () => {
  // Nest định danh module động theo THAM CHIẾU object, không theo nội dung
  // metadata — xem registerOnce trong common/utils/dynamic-module.util.ts. Hai
  // lời gọi register() trả về hai object khác nhau nghĩa là hai module khác
  // nhau, và mọi controller/provider/processor bên trong bị dựng hai bản.
  //
  // Lỗi này im lặng: route thừa thì lần khớp đầu thắng, còn một BullMQ
  // processor thừa chỉ hiện ra dưới dạng hai worker cùng rút việc từ một hàng
  // đợi. Nên nó cần một test, và test phải dùng toBe.
  it.each(DYNAMIC_MODULES)('%s.register()', (_name, register) => {
    expect(register()).toBe(register());
  });

  it('nhớ lại không được làm mất nội dung module', () => {
    // ReportModule là module bị import hai nơi (AppModule và GrpcModule), nên
    // lấy nó làm mẫu kiểm tra metadata vẫn nguyên vẹn sau khi bọc.
    const module = ReportModule.register();

    expect(module.module).toBe(ReportModule);
    expect(module.controllers).toHaveLength(1);
    expect(module.exports).toHaveLength(1);
  });
});
