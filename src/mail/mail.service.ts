import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { MailPayload } from './mail.constant';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly isRealTransport: boolean;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    this.from =
      this.config.get<string>('MAIL_FROM') ?? 'no-reply@store-web.local';
    this.isRealTransport = Boolean(host);

    this.transporter = host
      ? createTransport({
          host,
          port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
          secure: Number(this.config.get<string>('SMTP_PORT') ?? 587) === 465,
          auth: this.config.get<string>('SMTP_USER')
            ? {
                user: this.config.get<string>('SMTP_USER'),
                pass: this.config.get<string>('SMTP_PASSWORD'),
              }
            : undefined,
        })
      : createTransport({ jsonTransport: true });
  }

  async send(mail: MailPayload): Promise<void> {
    const info = (await this.transporter.sendMail({
      from: this.from,
      ...mail,
    })) as { messageId?: string; response?: string };

    if (!this.isRealTransport) {
      this.logger.log(
        `[MAIL-DEV] to=${mail.to} | subject=${mail.subject}\n${mail.text}`,
      );
      return;
    }

    this.logger.log(
      `Đã gửi mail tới ${mail.to} | subject=${mail.subject} | ` +
        `messageId=${info.messageId ?? '?'} | smtp=${(info.response ?? '').trim()}`,
    );
  }
}
