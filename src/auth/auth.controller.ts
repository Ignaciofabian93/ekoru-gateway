import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { I18nService } from '../common/i18n';

/** RFC 5321's longest address, and far more than bcrypt reads of a password. */
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 200;

/**
 * Sign-in attempts per address per minute, instead of the 100 every other
 * route gets (GW-5). The lock after 8 wrong passwords protects one account;
 * this slows down trying one password against many. It stays at 20 rather than
 * fewer because everyone behind one network (an office, the expo's WiFi) counts
 * as one address.
 */
const SIGN_IN_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/**
 * The email and password of a sign-in body, or null when either is missing or
 * isn't text. Unchecked, a body like `{}` reached `email.toLowerCase()` and
 * answered 500, which also counted in the error alerts (GW-7).
 */
export function readCredentials(
  body: unknown,
): { email: string; password: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const address = email.trim();
  if (!address || address.length > MAX_EMAIL_LENGTH) return null;
  if (!password || password.length > MAX_PASSWORD_LENGTH) return null;
  return { email: address, password };
}

/**
 * Caller's address for the login-alert email: `req.ip`, which Express takes
 * from the one proxy hop the gateway trusts (`trust proxy` in main.ts). The
 * left-most `X-Forwarded-For` entry it used to read is whatever the caller
 * sent, so an alert could show any address (GW-7).
 */
function clientIp(req: Request): string | undefined {
  return req.ip || req.socket?.remoteAddress || undefined;
}

@Controller('session')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly i18nService: I18nService,
  ) {}

  /** The body's credentials, or a 400 with the same words as a wrong password. */
  private credentials(body: unknown, language: string) {
    const credentials = readCredentials(body);
    if (!credentials) {
      throw new BadRequestException(
        this.i18nService.translate('auth.invalid_credentials', language),
      );
    }
    return credentials;
  }

  @Throttle(SIGN_IN_LIMIT)
  @Post('auth')
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const language = this.i18nService.parseAcceptLanguage(
      req.headers['accept-language'],
    );
    const { email, password } = this.credentials(body, language);
    return this.authService.login(email, password, res, language, {
      userAgent: req.headers['user-agent'],
      ipAddress: clientIp(req),
    });
  }

  @Post('refresh')
  refreshToken(
    @Body('refreshToken') refreshToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token: string = refreshToken || (req.cookies?.refreshToken as string);
    const language = this.i18nService.parseAcceptLanguage(
      req.headers['accept-language'],
    );
    return this.authService.refreshToken(token, res, language);
  }

  @Throttle(SIGN_IN_LIMIT)
  @Post('authAdmin')
  async loginAdmin(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const language = this.i18nService.parseAcceptLanguage(
      req.headers['accept-language'],
    );
    const { email, password } = this.credentials(body, language);
    return this.authService.loginAdmin(email, password, res, language);
  }

  @Post('refreshAdmin')
  refreshAdminToken(
    @Body('refreshToken') refreshToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token: string = refreshToken || (req.cookies?.refreshToken as string);
    const language = this.i18nService.parseAcceptLanguage(
      req.headers['accept-language'],
    );
    return this.authService.refreshAdminToken(token, res, language);
  }

  @Post('logout')
  logout(
    @Body('refreshToken') refreshTokenBody: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
      refreshTokenBody || (req.cookies?.refreshToken as string);
    return this.authService.logout(res, refreshToken);
  }
}
