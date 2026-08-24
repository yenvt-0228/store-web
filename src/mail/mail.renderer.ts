import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import { I18nService } from 'nestjs-i18n';
import { Locale, LOCALE_TAGS } from '../common/constants/locale.constant';
import { MailPayload, SHOP_NAME } from './mail.constant';

const TEMPLATE_DIR = join(__dirname, 'templates');

const CACHE_ENABLED = process.env.NODE_ENV === 'production';
const cache = new Map<string, HandlebarsTemplateDelegate>();

Handlebars.registerHelper(
  'p',
  function (this: unknown, options: Handlebars.HelperOptions) {
    const content: string = options.fn(this);
    return new Handlebars.SafeString(
      `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #24292f;">${content}</p>`,
    );
  },
);

Handlebars.registerHelper('link', (url: unknown) => {
  const href = Handlebars.escapeExpression(String(url));
  return new Handlebars.SafeString(
    `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; word-break: break-all;">` +
      `<a href="${href}" style="color: #1f6feb; text-decoration: underline;">${href}</a>` +
      `</p>`,
  );
});

function compile(relativePath: string): HandlebarsTemplateDelegate {
  const cached = cache.get(relativePath);
  if (cached) return cached;

  const source = readFileSync(join(TEMPLATE_DIR, relativePath), 'utf8');
  const template = Handlebars.compile(source);
  if (CACHE_ENABLED) cache.set(relativePath, template);

  return template;
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&#x60;': '`',
  '&#x3D;': '=',
  '&nbsp;': ' ',
};

const ENTITY_PATTERN = new RegExp(Object.keys(HTML_ENTITIES).join('|'), 'g');

function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(ENTITY_PATTERN, (entity) => HTML_ENTITIES[entity])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n');
}

@Injectable()
export class MailRenderer {
  constructor(private i18n: I18nService) {}

  /*  TÀI KHOẢN  */

  activation(
    to: string,
    name: string,
    link: string,
    lang: Locale,
  ): MailPayload {
    return this.render('activation', {
      to,
      name,
      lang,
      subjectKey: 'mail.ACTIVATION_SUBJECT',
      context: { link },
    });
  }

  resetPassword(
    to: string,
    name: string,
    link: string,
    lang: Locale,
  ): MailPayload {
    return this.render('reset-password', {
      to,
      name,
      lang,
      subjectKey: 'mail.RESET_PASSWORD_SUBJECT',
      context: { link },
    });
  }

  passwordChanged(to: string, name: string, lang: Locale): MailPayload {
    return this.render('password-changed', {
      to,
      name,
      lang,
      subjectKey: 'mail.PASSWORD_CHANGED_SUBJECT',
    });
  }

  /*  ĐƠN HÀNG  */

  orderCreated(
    to: string,
    name: string,
    orderCode: string,
    totalAmount: number,
    lang: Locale,
  ): MailPayload {
    return this.render('order-created', {
      to,
      name,
      lang,
      subjectKey: 'mail.ORDER_CREATED_SUBJECT',
      subjectArgs: { orderCode },
      context: { orderCode, money: this.money(totalAmount, lang) },
    });
  }

  orderConfirmed(
    to: string,
    name: string,
    orderCode: string,
    lang: Locale,
  ): MailPayload {
    return this.render('order-confirmed', {
      to,
      name,
      lang,
      subjectKey: 'mail.ORDER_CONFIRMED_SUBJECT',
      subjectArgs: { orderCode },
      context: { orderCode },
    });
  }

  orderRejected(
    to: string,
    name: string,
    orderCode: string,
    reason: string,
    lang: Locale,
  ): MailPayload {
    return this.render('order-rejected', {
      to,
      name,
      lang,
      subjectKey: 'mail.ORDER_REJECTED_SUBJECT',
      subjectArgs: { orderCode },
      context: { orderCode, reason },
    });
  }

  /*  Common chung */

  private money(amount: number, lang: Locale): string {
    return this.t('mail.MONEY', lang, {
      amount: new Intl.NumberFormat(LOCALE_TAGS[lang]).format(amount),
    });
  }

  private t(key: string, lang: Locale, args?: Record<string, unknown>): string {
    return this.i18n.t(key, { lang, args });
  }

  private translateHelper(lang: Locale) {
    return (key: string, options: Handlebars.HelperOptions) => {
      const args = Object.fromEntries(
        Object.entries(options.hash ?? {}).map(([name, value]) => [
          name,
          Handlebars.escapeExpression(String(value)),
        ]),
      );
      return new Handlebars.SafeString(this.t(key, lang, args));
    };
  }

  private render(
    template: string,
    options: {
      to: string;
      name: string;
      lang: Locale;
      subjectKey: string;
      subjectArgs?: Record<string, unknown>;
      context?: Record<string, unknown>;
    },
  ): MailPayload {
    const { to, name, lang, subjectKey, subjectArgs, context } = options;

    const subject = this.t(subjectKey, lang, subjectArgs);

    const helpers = { t: this.translateHelper(lang) };

    const body = compile(`${template}.hbs`)(context ?? {}, { helpers });

    const html = compile('layouts/main.hbs')(
      {
        body,
        name,
        subject,
        shopName: SHOP_NAME,
        year: new Date().getFullYear(),
      },
      { helpers },
    );

    const greeting = this.t('mail.GREETING', lang, { name });

    return {
      to,
      subject,
      html,
      text: `${toPlainText(greeting)}\n\n${toPlainText(body)}`,
    };
  }
}
