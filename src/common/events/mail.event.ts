import type { Locale } from '../constants/locale.constant';

export const MailEvent = {
  USER_REGISTERED: 'user.registered',
  PASSWORD_RESET_REQUESTED: 'user.password-reset-requested',
  PASSWORD_CHANGED: 'user.password-changed',
} as const;

export interface UserRegisteredEvent {
  email: string;
  name: string;
  token: string;
  locale: Locale;
}

export interface PasswordResetRequestedEvent {
  email: string;
  name: string;
  token: string;
  locale: Locale;
}

export interface PasswordChangedEvent {
  email: string;
  name: string;
  locale: Locale;
}
