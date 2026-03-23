import { Injectable } from '@nestjs/common';
import {
  translations,
  DEFAULT_LANGUAGE,
  type SupportedLanguage,
} from '../../i18n/messages';

/**
 * I18N Service for the gateway - Stateless language utilities
 *
 * Parses Accept-Language headers and translates message keys.
 * Used in auth and other REST endpoints to return localized error messages.
 */
@Injectable()
export class I18nService {
  /**
   * Parses the Accept-Language header and returns the best matching supported language code.
   * Falls back to DEFAULT_LANGUAGE ('ES') if no supported language is found.
   *
   * @param {string | undefined} acceptLanguageHeader - The Accept-Language header value
   * @returns {SupportedLanguage} The matched language code or default
   *
   * @example
   * parseAcceptLanguage('en-US,en;q=0.9,es;q=0.8') // 'EN'
   * parseAcceptLanguage('fr-FR')                     // 'ES' (not supported, falls back)
   * parseAcceptLanguage(undefined)                   // 'ES'
   */
  parseAcceptLanguage(
    acceptLanguageHeader: string | undefined,
  ): SupportedLanguage {
    if (!acceptLanguageHeader) {
      return DEFAULT_LANGUAGE;
    }

    // Format: "en-US,en;q=0.9,es;q=0.8,fr;q=0.7"
    const languages = acceptLanguageHeader
      .split(',')
      .map((lang) => {
        const [code, qStr] = lang.trim().split(';');
        const q = qStr ? parseFloat(qStr.split('=')[1]) : 1.0;
        return { code: code.split('-')[0].toUpperCase(), q };
      })
      .sort((a, b) => b.q - a.q);

    for (const { code } of languages) {
      if (translations[code]) {
        return code;
      }
    }

    return DEFAULT_LANGUAGE;
  }

  /**
   * Translates a message key to the requested language.
   * Falls back to DEFAULT_LANGUAGE if the key is not found in the requested language.
   * Returns the key itself as last resort.
   *
   * Supports {{param}} interpolation in message strings.
   *
   * @param {string} key - Message key (e.g. 'auth.user_not_found')
   * @param {SupportedLanguage} language - Target language code
   * @param {Record<string, string>} [params] - Optional interpolation params
   * @returns {string} Translated and interpolated message
   */
  translate(
    key: string,
    language: SupportedLanguage,
    params?: Record<string, string>,
  ): string {
    const map = translations[language] ?? translations[DEFAULT_LANGUAGE];
    let message = map?.[key];

    if (!message && language !== DEFAULT_LANGUAGE) {
      message = translations[DEFAULT_LANGUAGE]?.[key];
    }

    if (!message) return key;

    if (params) {
      message = Object.entries(params).reduce(
        (msg, [k, v]) => msg.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v),
        message,
      );
    }

    return message;
  }
}
