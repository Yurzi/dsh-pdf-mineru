import { en, type MineruKey } from './locales.js'

const ENGLISH_FALLBACK_LOCALES = [
  'ja', 'de', 'fr', 'pt', 'ko', 'ar', 'hi', 'id',
  'tr', 'vi', 'th', 'ru', 'it', 'nl', 'sv', 'pl',
] as const

/**
 * BetterLocale does not inherit the base locale service's English fallback.
 * Reuse one canonical English dictionary instead of maintaining sixteen
 * byte-for-byte copies that falsely appear to be translations.
 */
export const dicts = Object.fromEntries(
  ENGLISH_FALLBACK_LOCALES.map(locale => [locale, en]),
) as Record<string, Record<MineruKey, string>>
