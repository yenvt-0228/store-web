export const SUPPORTED_LOCALES = ['vi', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'vi';

export function toLocale(value: string | null | undefined): Locale {
  return SUPPORTED_LOCALES.includes(value as Locale)
    ? (value as Locale)
    : DEFAULT_LOCALE;
}

export const LOCALE_TAGS: Record<Locale, string> = {
  vi: 'vi-VN',
  en: 'en-US',
};
