import { DynamicModule, Module } from '@nestjs/common';
import { registerOnce } from './dynamic-module.util';

@Module({})
class Dummy {}

describe('registerOnce', () => {
  it('trả về CÙNG MỘT object ở mọi lời gọi', () => {
    // toBe, không phải toEqual: Nest so sánh theo tham chiếu, nên "giống nhau"
    // không cứu được gì — và toEqual sẽ xanh ngay cả khi lỗi quay lại.
    const register = registerOnce(() => ({ module: Dummy }));

    expect(register()).toBe(register());
  });

  it('chỉ chạy hàm dựng đúng một lần', () => {
    const build = jest.fn((): DynamicModule => ({
      module: Dummy,
      providers: [],
    }));
    const register = registerOnce(build);

    register();
    register();
    register();

    expect(build).toHaveBeenCalledTimes(1);
  });

  it('chưa gọi thì chưa dựng — cấu hình đọc lúc gọi, không phải lúc import', () => {
    // Quan trọng: các module đọc biến môi trường trong thân hàm dựng, mà biến
    // đó có thể được nạp sau khi file này được import.
    const build = jest.fn((): DynamicModule => ({ module: Dummy }));

    registerOnce(build);

    expect(build).not.toHaveBeenCalled();
  });
});
