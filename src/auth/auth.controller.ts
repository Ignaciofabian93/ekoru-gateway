import { Controller, Post, Body, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { I18nService } from '../common/i18n';

class LoginDto {
  email!: string;
  password!: string;
}

/**
 * Caller IP for the login-alert email. Behind the reverse proxy the socket
 * address is the proxy's, so the left-most `X-Forwarded-For` entry — the
 * original client — wins when present. Purely informational: it is shown to
 * the account owner, never used for an access decision.
 */
function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(',')[0]?.trim();
  return first || req.ip || req.socket?.remoteAddress || undefined;
}

@Controller('session')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly i18nService: I18nService,
  ) {}

  @Post('auth')
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const language = this.i18nService.parseAcceptLanguage(
      req.headers['accept-language'],
    );
    return this.authService.login(
      loginDto.email,
      loginDto.password,
      res,
      language,
      {
        userAgent: req.headers['user-agent'],
        ipAddress: clientIp(req),
      },
    );
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

  @Post('authAdmin')
  async loginAdmin(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const language = this.i18nService.parseAcceptLanguage(
      req.headers['accept-language'],
    );
    return this.authService.loginAdmin(
      loginDto.email,
      loginDto.password,
      res,
      language,
    );
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
