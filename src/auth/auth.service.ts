import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Response } from 'express';
import { I18nService } from '../common/i18n';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '../i18n/messages';
import { TokenRepository } from './token.repository';
import {
  NotificationsClient,
  type LoginAlertDetails,
} from '../mail/notifications.client';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Failed attempts tolerated before a seller account is temporarily locked. */
const MAX_LOGIN_ATTEMPTS = 8;

/**
 * How long the lock lasts. Long enough to make online guessing pointless, short
 * enough that a legitimate owner who fat-fingered their password is not calling
 * support. The lock is timed rather than permanent (as Admin's is) because a
 * permanent lock on a public endpoint would let anyone disable any account.
 */
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * A real bcrypt hash, of a value nothing can log in with. Compared against when
 * the email is unknown so that "no such account" costs the same wall-clock time
 * as "wrong password" — otherwise the timing difference is itself the oracle
 * the shared error message is meant to close.
 */
const DUMMY_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly i18nService: I18nService,
    private readonly tokenRepository: TokenRepository,
    private readonly notifications: NotificationsClient,
  ) {}

  private setCookies(res: Response, token: string, refreshToken: string) {
    const environment = this.configService.get<string>(
      'ENVIRONMENT',
      'development',
    );
    const isSecure = environment === 'production' || environment === 'qa';
    const domain = isSecure ? '.ekoru.cl' : undefined;

    res.cookie('token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'strict' : 'lax',
      maxAge: 15 * 60 * 1000,
      domain,
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'strict' : 'lax',
      maxAge: REFRESH_TOKEN_TTL_MS,
      domain,
    });
  }

  /**
   * Counts a failed attempt and locks the account once the threshold is hit.
   *
   * The counter is not reset when the lock is applied — it is cleared on the
   * next successful sign-in. That means an attacker who waits out one lock and
   * guesses wrong again is re-locked immediately rather than getting a fresh
   * budget of attempts.
   */
  private async registerFailedLogin(
    sellerId: string,
    currentAttempts: number,
  ): Promise<void> {
    const attempts = currentAttempts + 1;
    await this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        loginAttempts: attempts,
        lockedUntil:
          attempts >= MAX_LOGIN_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_MS)
            : null,
      },
    });
  }

  private signRefreshToken(payload: Record<string, string>): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });
  }

  async login(
    email: string,
    password: string,
    res: Response,
    language: SupportedLanguage = DEFAULT_LANGUAGE,
    device: LoginAlertDetails = {},
  ) {
    const formattedEmail = email.toLowerCase();
    const user = await this.prisma.seller.findUnique({
      where: { email: formattedEmail },
    });

    // One message for "no such account" and "wrong password" alike. Answering
    // them differently turns this endpoint into a membership oracle: an
    // attacker learns which addresses have accounts without guessing a single
    // password. The password-reset flow (EK-4) was deliberately built this way;
    // login should match it.
    const rejectCredentials = () =>
      new BadRequestException(
        this.i18nService.translate('auth.invalid_credentials', language),
      );

    if (!user) {
      // Still spend the time a real bcrypt compare would, so response latency
      // does not leak whether the address exists.
      await compare(password, DUMMY_HASH);
      throw rejectCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new BadRequestException(
        this.i18nService.translate('auth.account_locked', language),
      );
    }

    const valid = await compare(password, user.password);
    if (!valid) {
      await this.registerFailedLogin(user.id, user.loginAttempts);
      throw rejectCredentials();
    }

    // Successful sign-in clears the counter and any expired lock.
    if (user.loginAttempts !== 0 || user.lockedUntil) {
      await this.prisma.seller.update({
        where: { id: user.id },
        data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
    } else {
      await this.prisma.seller.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
    }

    const token = this.jwtService.sign(
      { sellerId: user.id },
      { expiresIn: '15m' },
    );

    const refreshToken = this.signRefreshToken({ sellerId: user.id });

    await this.tokenRepository.save(
      refreshToken,
      user.id,
      'seller',
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    );

    this.setCookies(res, token, refreshToken);

    // Security notice, not part of the sign-in contract: users decides whether
    // to actually send it (SellerPreferences.enableLoginAlerts). Not awaited so
    // a slow SMTP hop can't stall the login, and the rejection is caught here
    // rather than surfacing as an unhandled rejection.
    this.notifications
      .sendLoginAlert(user.id, { ...device, occurredAt: new Date() })
      .catch(() => undefined);

    return {
      token,
      refreshToken,
      message: this.i18nService.translate('auth.login_success', language),
    };
  }

  async loginAdmin(
    email: string,
    password: string,
    res: Response,
    language: SupportedLanguage = DEFAULT_LANGUAGE,
  ) {
    const formattedEmail = email.toLowerCase();
    const admin = await this.prisma.admin.findUnique({
      where: { email: formattedEmail },
    });

    if (!admin) {
      throw new BadRequestException(
        this.i18nService.translate('auth.admin_not_found', language),
      );
    }

    if (!admin.isActive) {
      throw new BadRequestException(
        this.i18nService.translate('auth.account_disabled', language),
      );
    }

    if (admin.accountLocked) {
      throw new BadRequestException(
        this.i18nService.translate('auth.account_locked', language),
      );
    }

    const valid = await compare(password, admin.password);
    if (!valid) {
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: { loginAttempts: { increment: 1 } },
      });
      throw new BadRequestException(
        this.i18nService.translate('auth.invalid_credentials', language),
      );
    }

    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { loginAttempts: 0, lastLoginAt: new Date() },
    });

    // Role, type and business scope travel in the token so the subgraphs can
    // enforce them. Until now the token carried only `adminId`, and every
    // subgraph guard was a presence check — so any admin was effectively
    // SUPER_ADMIN against the API, and the PLATFORM/BUSINESS split existed
    // only in the React client.
    const adminClaims = {
      adminId: admin.id,
      adminRole: admin.role,
      adminType: admin.adminType,
      // Business admins are scoped to their own seller; null for platform staff.
      adminSellerId: admin.sellerId ?? null,
    };

    const token = this.jwtService.sign(adminClaims, { expiresIn: '15m' });

    const refreshToken = this.signRefreshToken({ adminId: admin.id });

    await this.tokenRepository.save(
      refreshToken,
      admin.id,
      'admin',
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    );

    this.setCookies(res, token, refreshToken);

    return {
      token,
      message: this.i18nService.translate('auth.login_success', language),
    };
  }

  async refreshToken(
    refreshToken: string,
    res: Response,
    language: SupportedLanguage = DEFAULT_LANGUAGE,
  ) {
    if (!refreshToken) {
      throw new UnauthorizedException(
        this.i18nService.translate('auth.token_refresh_failed', language),
      );
    }

    try {
      const payload: { sellerId: string } = this.jwtService.verify(
        refreshToken,
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET') },
      );

      const revoked = await this.tokenRepository.isRevoked(refreshToken);
      if (revoked) {
        throw new UnauthorizedException(
          this.i18nService.translate('auth.token_revoked', language),
        );
      }

      // Rotate: revoke the used token and issue a new pair
      await this.tokenRepository.revoke(refreshToken);

      const newToken = this.jwtService.sign(
        { sellerId: payload.sellerId },
        { expiresIn: '15m' },
      );

      const newRefreshToken = this.signRefreshToken({
        sellerId: payload.sellerId,
      });

      await this.tokenRepository.save(
        newRefreshToken,
        payload.sellerId,
        'seller',
        new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      );

      this.setCookies(res, newToken, newRefreshToken);

      return { token: newToken, refreshToken: newRefreshToken, success: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException(
        this.i18nService.translate('auth.token_invalid', language),
      );
    }
  }

  async refreshAdminToken(
    refreshToken: string,
    res: Response,
    language: SupportedLanguage = DEFAULT_LANGUAGE,
  ) {
    if (!refreshToken) {
      throw new UnauthorizedException(
        this.i18nService.translate('auth.token_refresh_failed', language),
      );
    }

    try {
      const payload: { adminId: string } = this.jwtService.verify(
        refreshToken,
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET') },
      );

      const revoked = await this.tokenRepository.isRevoked(refreshToken);
      if (revoked) {
        throw new UnauthorizedException(
          this.i18nService.translate('auth.token_revoked', language),
        );
      }

      await this.tokenRepository.revoke(refreshToken);

      // Re-read the admin rather than trusting the old token's claims. This is
      // the only point at which a role change, a deactivation or a lock takes
      // effect — without it, those were checked at login and then not again for
      // the seven-day life of the refresh token.
      const admin = await this.prisma.admin.findUnique({
        where: { id: payload.adminId },
        select: {
          id: true,
          role: true,
          adminType: true,
          sellerId: true,
          isActive: true,
          accountLocked: true,
        },
      });

      if (!admin || !admin.isActive || admin.accountLocked) {
        throw new UnauthorizedException(
          this.i18nService.translate('auth.account_disabled', language),
        );
      }

      const newToken = this.jwtService.sign(
        {
          adminId: admin.id,
          adminRole: admin.role,
          adminType: admin.adminType,
          adminSellerId: admin.sellerId ?? null,
        },
        { expiresIn: '15m' },
      );

      const newRefreshToken = this.signRefreshToken({
        adminId: payload.adminId,
      });

      await this.tokenRepository.save(
        newRefreshToken,
        payload.adminId,
        'admin',
        new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      );

      this.setCookies(res, newToken, newRefreshToken);

      return { token: newToken, refreshToken: newRefreshToken, success: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException(
        this.i18nService.translate('auth.token_invalid', language),
      );
    }
  }

  decodeToken(token: string): { sellerId: string } | null {
    if (!token) {
      return null;
    }

    try {
      const decoded: { sellerId: string } = this.jwtService.verify(token);
      return decoded;
    } catch {
      console.error(
        'Failed to decode with regular secret, trying refresh secret',
      );
    }

    try {
      const refreshDecoded: { sellerId: string } = this.jwtService.verify(
        token,
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET') },
      );
      return refreshDecoded;
    } catch (error) {
      console.error('Error decoding token with both secrets:', error);
      return null;
    }
  }

  async logout(res: Response, refreshToken?: string) {
    if (refreshToken) {
      await this.tokenRepository.revoke(refreshToken);
    }

    const environment = this.configService.get<string>(
      'ENVIRONMENT',
      'development',
    );
    const isSecure = environment === 'production' || environment === 'qa';
    const domain = isSecure ? '.ekoru.cl' : undefined;

    res.clearCookie('token', {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'strict' : 'lax',
      domain,
    });

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'strict' : 'lax',
      domain,
    });

    return {
      success: true,
      message: this.i18nService.translate(
        'auth.session_closed',
        DEFAULT_LANGUAGE,
      ),
    };
  }
}
