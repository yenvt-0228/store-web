import { DynamicModule } from '@nestjs/common';

/**
 * Bọc hàm dựng một `DynamicModule` sao cho nó chỉ chạy một lần.
 *
 * Nest định danh module ĐỘNG theo *tham chiếu object*, không theo nội dung
 * metadata: `ByReferenceModuleOpaqueKeyFactory` — mặc định từ Nest 11 — đóng một
 * id ngẫu nhiên lên chính object rồi nhớ id đó trên object:
 *
 * ```js
 * if (originalRef[K_MODULE_ID]) return originalRef[K_MODULE_ID];
 * moduleId = this.generateRandomString();
 * originalRef[K_MODULE_ID] = moduleId;
 * ```
 *
 * Nghĩa là hai lời gọi `register()` trả về hai object khác nhau sẽ thành hai
 * module khác nhau, dù metadata giống hệt từng chữ — và mọi controller,
 * provider, processor bên trong bị dựng hai bản. Lỗi này im lặng: route thừa
 * thì lần khớp đầu thắng, còn một BullMQ processor thừa chỉ hiện ra dưới dạng
 * hai worker cùng rút việc từ một hàng đợi.
 *
 * Bọc bằng hàm này thì mọi nơi import nhận đúng một object, và Nest gộp lại.
 *
 * Chỉ dùng được cho `register()` KHÔNG tham số. Có tham số thì kết quả phải
 * phụ thuộc tham số, mà ở đây thì lời gọi thứ hai sẽ lặng lẽ nhận lại cấu hình
 * của lời gọi thứ nhất.
 *
 * Cố ý không có hàm reset: cấu hình các module này đọc từ biến môi trường, mà
 * biến môi trường không đổi giữa chừng trong một process. Mỗi file test của
 * Jest lại chạy trên một module registry riêng, nên biến static cũng được dựng
 * lại theo từng file.
 *
 * @param build - Hàm dựng metadata của module.
 * @returns Hàm trả về cùng một `DynamicModule` ở mọi lời gọi.
 */
export function registerOnce(build: () => DynamicModule): () => DynamicModule {
  let cached: DynamicModule | undefined;

  return () => (cached ??= build());
}
