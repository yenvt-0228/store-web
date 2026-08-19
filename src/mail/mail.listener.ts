import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { MailEvent } from '../common/events/mail.event';

import type {
  PasswordChangedEvent,
  PasswordResetRequestedEvent,
  UserRegisteredEvent,
} from '../common/events/mail.event';
import { MailDispatcher } from './mail.dispatcher';
import {
  activationMail,
  passwordChangedMail,
  resetPasswordMail,
} from './mail.template';

@Injectable()
export class MailListener {
  constructor(
    private dispatcher: MailDispatcher,
    private config: ConfigService,
  ) {}

  private get apiUrl(): string {
    return (
      this.config.get<string>('APP_URL') ??
      `http://localhost:${this.config.get<string>('PORT') ?? 3000}`
    );
  }

  private get webUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? this.apiUrl;
  }

  @OnEvent(MailEvent.USER_REGISTERED)
  async onUserRegistered(event: UserRegisteredEvent): Promise<void> {
    const link = `${this.apiUrl}/auth/activate?token=${event.token}`;
    await this.dispatcher.dispatch(
      activationMail(event.email, event.name, link),
    );
  }

  @OnEvent(MailEvent.PASSWORD_RESET_REQUESTED)
  async onPasswordResetRequested(
    event: PasswordResetRequestedEvent,
  ): Promise<void> {
    const link = `${this.webUrl}/reset-password?token=${event.token}`;
    await this.dispatcher.dispatch(
      resetPasswordMail(event.email, event.name, link),
    );
  }

  @OnEvent(MailEvent.PASSWORD_CHANGED)
  async onPasswordChanged(event: PasswordChangedEvent): Promise<void> {
    await this.dispatcher.dispatch(
      passwordChangedMail(event.email, event.name),
    );
  }
}
