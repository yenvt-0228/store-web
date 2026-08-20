import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
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

function toPlainText(bodyHtml: string): string {
  return bodyHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(ENTITY_PATTERN, (entity) => HTML_ENTITIES[entity])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n');
}

function render(
  template: string,
  to: string,
  name: string,
  subject: string,
  context: Record<string, unknown> = {},
): MailPayload {
  const body = compile(`${template}.hbs`)({ name, ...context });

  const html = compile('layouts/main.hbs')({
    body,
    name,
    subject,
    shopName: SHOP_NAME,
    year: new Date().getFullYear(),
  });

  return {
    to,
    subject,
    html,
    text: `Xin chào ${name},\n\n${toPlainText(body)}`,
  };
}

export function activationMail(
  to: string,
  name: string,
  link: string,
): MailPayload {
  return render('activation', to, name, 'Kích hoạt tài khoản', { link });
}

export function resetPasswordMail(
  to: string,
  name: string,
  link: string,
): MailPayload {
  return render('reset-password', to, name, 'Đặt lại mật khẩu', { link });
}

export function passwordChangedMail(to: string, name: string): MailPayload {
  return render('password-changed', to, name, 'Mật khẩu đã được thay đổi');
}

export function orderCreatedMail(
  to: string,
  name: string,
  orderCode: string,
  totalAmount: number,
): MailPayload {
  return render('order-created', to, name, `Đã nhận đơn hàng ${orderCode}`, {
    orderCode,
    money: totalAmount.toLocaleString('vi-VN'),
  });
}

export function orderConfirmedMail(
  to: string,
  name: string,
  orderCode: string,
): MailPayload {
  return render(
    'order-confirmed',
    to,
    name,
    `Đơn hàng ${orderCode} đã được xác nhận`,
    { orderCode },
  );
}

export function orderRejectedMail(
  to: string,
  name: string,
  orderCode: string,
  reason: string,
): MailPayload {
  return render(
    'order-rejected',
    to,
    name,
    `Đơn hàng ${orderCode} bị từ chối`,
    { orderCode, reason },
  );
}
