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

    if (!user) {
      throw new BadRequestException(
        this.i18nService.translate('auth.user_not_found', language),
      );
    }

    const valid = await compare(password, user.password);
    if (!valid) {
      throw new BadRequestException(
        this.i18nService.translate('auth.invalid_credentials', language),
      );
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

    const token = this.jwtService.sign(
      { adminId: admin.id },
      { expiresIn: '15m' },
    );

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

      const newToken = this.jwtService.sign(
        { adminId: payload.adminId },
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
