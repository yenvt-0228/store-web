import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { MailEvent } from '../common/events/mail.event';
import type {
  OrderConfirmedEvent,
  OrderCreatedEvent,
  OrderRejectedEvent,
} from '../common/events/order.event';
import { OrderEvent } from '../common/events/order.event';

import type {
  PasswordChangedEvent,
  PasswordResetRequestedEvent,
  UserRegisteredEvent,
} from '../common/events/mail.event';
import { MailDispatcher } from './mail.dispatcher';
import {
  activationMail,
  orderConfirmedMail,
  orderCreatedMail,
  orderRejectedMail,
  passwordChangedMail,
  resetPasswordMail,
} from './mail.renderer';

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

  @OnEvent(OrderEvent.CREATED)
  async onOrderCreated(event: OrderCreatedEvent): Promise<void> {
    await this.dispatcher.dispatch(
      orderCreatedMail(
        event.email,
        event.name,
        event.orderCode,
        event.totalAmount,
      ),
    );
  }

  @OnEvent(OrderEvent.CONFIRMED)
  async onOrderConfirmed(event: OrderConfirmedEvent): Promise<void> {
    await this.dispatcher.dispatch(
      orderConfirmedMail(event.email, event.name, event.orderCode),
    );
  }

  @OnEvent(OrderEvent.REJECTED)
  async onOrderRejected(event: OrderRejectedEvent): Promise<void> {
    await this.dispatcher.dispatch(
      orderRejectedMail(event.email, event.name, event.orderCode, event.reason),
    );
  }
}
