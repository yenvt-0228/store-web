export const RoleName = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;

export type RoleName = (typeof RoleName)[keyof typeof RoleName];
