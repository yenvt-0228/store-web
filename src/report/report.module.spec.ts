import { ReportModule } from './report.module';

describe('ReportModule.register', () => {
  it('trả về CÙNG MỘT object cho mọi nơi import', () => {
    // Đây là bất biến khiến Nest gộp được hai chỗ import làm một.
    // `ByReferenceModuleOpaqueKeyFactory` (mặc định từ Nest 11) đóng một id
    // ngẫu nhiên lên chính object rồi nhớ id đó trên object — nên "giống nhau"
    // không đủ, phải là *cùng một* object.
    //
    // toBe, không phải toEqual: toEqual sẽ xanh ngay cả khi lỗi quay lại.
    expect(ReportModule.register()).toBe(ReportModule.register());
  });

  it('vẫn khai đúng ReportController và export ReportService', () => {
    // Nhớ lại kết quả không được làm mất nội dung module.
    const module = ReportModule.register();

    expect(module.module).toBe(ReportModule);
    expect(module.controllers).toHaveLength(1);
    expect(module.exports).toHaveLength(1);
  });
});
