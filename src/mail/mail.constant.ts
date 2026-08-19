export const MAIL_QUEUE = 'mail';

export const MailJob = {
  SEND: 'send',
} as const;

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}
