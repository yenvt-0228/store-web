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
import { MailRenderer } from './mail.renderer';

@Injectable()
export class MailListener {
  constructor(
    private dispatcher: MailDispatcher,
    private renderer: MailRenderer,
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
      this.renderer.activation(event.email, event.name, link, event.locale),
    );
  }

  @OnEvent(MailEvent.PASSWORD_RESET_REQUESTED)
  async onPasswordResetRequested(
    event: PasswordResetRequestedEvent,
  ): Promise<void> {
    const link = `${this.webUrl}/reset-password?token=${event.token}`;
    await this.dispatcher.dispatch(
      this.renderer.resetPassword(event.email, event.name, link, event.locale),
    );
  }

  @OnEvent(MailEvent.PASSWORD_CHANGED)
  async onPasswordChanged(event: PasswordChangedEvent): Promise<void> {
    await this.dispatcher.dispatch(
      this.renderer.passwordChanged(event.email, event.name, event.locale),
    );
  }

  @OnEvent(OrderEvent.CREATED)
  async onOrderCreated(event: OrderCreatedEvent): Promise<void> {
    await this.dispatcher.dispatch(
      this.renderer.orderCreated(
        event.email,
        event.name,
        event.orderCode,
        event.totalAmount,
        event.locale,
      ),
    );
  }

  @OnEvent(OrderEvent.CONFIRMED)
  async onOrderConfirmed(event: OrderConfirmedEvent): Promise<void> {
    await this.dispatcher.dispatch(
      this.renderer.orderConfirmed(
        event.email,
        event.name,
        event.orderCode,
        event.locale,
      ),
    );
  }

  @OnEvent(OrderEvent.REJECTED)
  async onOrderRejected(event: OrderRejectedEvent): Promise<void> {
    await this.dispatcher.dispatch(
      this.renderer.orderRejected(
        event.email,
        event.name,
        event.orderCode,
        event.reason,
        event.locale,
      ),
    );
  }
}
