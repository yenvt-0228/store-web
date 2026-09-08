import { AppRole, resolveAppRole, runsBackgroundJobs } from './app-role';

describe('app-role', () => {
  const original = process.env.APP_ROLE;

  afterEach(() => {
    if (original === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = original;
  });

  it('không khai báo APP_ROLE thì mặc định all — giữ nguyên hành vi cũ', () => {
    delete process.env.APP_ROLE;
    expect(resolveAppRole()).toBe(AppRole.ALL);
    expect(runsBackgroundJobs()).toBe(true);
  });

  it('bỏ qua khoảng trắng và chữ hoa', () => {
    process.env.APP_ROLE = '  WORKER ';
    expect(resolveAppRole()).toBe(AppRole.WORKER);
  });

  it('giá trị lạ thì ném lỗi, không âm thầm rơi về all', () => {
    process.env.APP_ROLE = 'workers';
    expect(() => resolveAppRole()).toThrow(/APP_ROLE="workers"/);
  });

  it('chỉ role api là không chạy việc nền', () => {
    expect(runsBackgroundJobs(AppRole.API)).toBe(false);
    expect(runsBackgroundJobs(AppRole.WORKER)).toBe(true);
    expect(runsBackgroundJobs(AppRole.ALL)).toBe(true);
  });
});
