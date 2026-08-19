export const MailEvent = {
  USER_REGISTERED: 'user.registered',
  PASSWORD_RESET_REQUESTED: 'user.password-reset-requested',
  PASSWORD_CHANGED: 'user.password-changed',
} as const;

export interface UserRegisteredEvent {
  email: string;
  name: string;
  token: string;
}

export interface PasswordResetRequestedEvent {
  email: string;
  name: string;
  token: string;
}

export interface PasswordChangedEvent {
  email: string;
  name: string;
}
