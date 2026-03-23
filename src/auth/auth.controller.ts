import { Controller, Post, Body, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { I18nService } from '../common/i18n';

class LoginDto {
  email: string;
  password: string;
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
    return this.authService.login(loginDto.email, loginDto.password, res, language);
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
  logout(@Res({ passthrough: true }) res: Response) {
    return this.authService.logout(res);
  }
}
