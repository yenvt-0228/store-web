export const AppRole = {
  API: 'api',
  WORKER: 'worker',
  ALL: 'all',
} as const;

export type AppRole = (typeof AppRole)[keyof typeof AppRole];

const VALID_ROLES: readonly string[] = Object.values(AppRole);

// APP_ROLE quyết định process hiện tại làm gì:
//   api    — chỉ phục vụ HTTP: không đăng ký cron, không tiêu thụ job trong queue
//   worker — chỉ chạy việc nền: cron + job, không mở cổng HTTP (dùng main.worker.ts)
//   all    — cả hai trong một process (mặc định, giữ nguyên hành vi trước đây)
export function resolveAppRole(): AppRole {
  const raw = (process.env.APP_ROLE ?? AppRole.ALL).trim().toLowerCase();

  // Không âm thầm fallback: gõ sai thành "workers" mà rơi về "all" thì cả process
  // API lẫn process worker đều chạy cron, dọn dữ liệu hai lần vào cùng thời điểm.
  if (!VALID_ROLES.includes(raw)) {
    throw new Error(
      `APP_ROLE="${process.env.APP_ROLE}" không hợp lệ — chỉ nhận: ${VALID_ROLES.join(', ')}.`,
    );
  }

  return raw as AppRole;
}

// Process này có chạy cron và tiêu thụ job trong queue hay không.
export function runsBackgroundJobs(role: AppRole = resolveAppRole()): boolean {
  return role !== AppRole.API;
}
