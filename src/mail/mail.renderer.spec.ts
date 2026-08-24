import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { MailRenderer } from './mail.renderer';

const UNTRANSLATED_KEY = /\bmail\.[A-Z][A-Z_]*/;

describe('MailRenderer', () => {
  let renderer: MailRenderer;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          fallbackLanguage: 'en',
          loaderOptions: { path: join(__dirname, '..', 'i18n') },
          resolvers: [AcceptLanguageResolver],
        }),
      ],
      providers: [MailRenderer],
    }).compile();

    renderer = moduleRef.get(MailRenderer);
  });

  it('render tiếng Việt: tiêu đề, lời chào và tiền theo định dạng vi-VN', () => {
    const mail = renderer.orderCreated(
      'a@b.com',
      'Yến',
      'ORD-20260821-4F2A9C',
      1_250_000,
      'vi',
    );

    expect(mail.subject).toBe('Đã nhận đơn hàng ORD-20260821-4F2A9C');
    expect(mail.html).toContain('Xin chào <b>Yến</b>,');
    expect(mail.html).toContain('1.250.000đ');
    expect(mail.html).toContain('Email này được gửi tự động');
    expect(mail.text).toContain('Xin chào Yến,');
  });

  it('render tiếng Anh: cùng dữ liệu, khác ngôn ngữ và khác định dạng tiền', () => {
    const mail = renderer.orderCreated(
      'a@b.com',
      'Yen',
      'ORD-20260821-4F2A9C',
      1_250_000,
      'en',
    );

    expect(mail.subject).toBe('Order ORD-20260821-4F2A9C received');
    expect(mail.html).toContain('Hi <b>Yen</b>,');
    expect(mail.html).toContain('1,250,000 VND');
    expect(mail.html).toContain('This is an automated email');
    expect(mail.text).toContain('Hi Yen,');
  });

  it('mọi mail đều render được ở cả hai ngôn ngữ', () => {
    for (const lang of ['vi', 'en'] as const) {
      const mails = [
        renderer.activation('a@b.com', 'U', 'http://x/y?token=1', lang),
        renderer.resetPassword('a@b.com', 'U', 'http://x/y?token=1', lang),
        renderer.passwordChanged('a@b.com', 'U', lang),
        renderer.orderCreated('a@b.com', 'U', 'ORD-1', 1000, lang),
        renderer.orderConfirmed('a@b.com', 'U', 'ORD-1', lang),
        renderer.orderRejected('a@b.com', 'U', 'ORD-1', 'Hết hàng', lang),
      ];

      for (const mail of mails) {
        // Template không chứa chữ, mọi câu đều gọi {{t 'mail.KEY'}}. Thiếu key
        // thì nestjs-i18n trả về chính chuỗi key -> lọt ra html/text/subject.
        // Đây là chốt chính của thiết kế một-template: quét cả ba chỗ.
        expect(mail.subject).not.toMatch(UNTRANSLATED_KEY);
        expect(mail.html).not.toMatch(UNTRANSLATED_KEY);
        expect(mail.text).not.toMatch(UNTRANSLATED_KEY);
        expect(mail.html).toContain('<!doctype html>');
        expect(mail.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('mọi ngôn ngữ có đúng cùng một bộ key — thêm câu mà quên dịch là đỏ', () => {
    const keysOf = (lang: string) =>
      Object.keys(
        JSON.parse(
          readFileSync(
            join(__dirname, '..', 'i18n', lang, 'mail.json'),
            'utf8',
          ),
        ) as Record<string, string>,
      ).sort();

    expect(keysOf('en')).toEqual(keysOf('vi'));
  });

  it('link giữ nguyên dấu = trong bản text (không bị escape thành &#x3D;)', () => {
    const mail = renderer.activation(
      'a@b.com',
      'U',
      'http://localhost:3001/auth/activate?token=abc123',
      'vi',
    );

    expect(mail.text).toContain('?token=abc123');
  });

  it('dữ liệu người dùng nhập không chèn được thẻ vào html', () => {
    const mail = renderer.orderRejected(
      'a@b.com',
      '<script>alert(1)</script>',
      'ORD-1',
      'Hết hàng <img src=x onerror=alert(1)>',
      'vi',
    );

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
