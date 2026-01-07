import { Controller, Post, Body, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';

class LoginDto {
  email: string;
  password: string;
}

@Controller('session')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(loginDto.email, loginDto.password, res);
  }

  @Post('refresh')
  refreshToken(
    @Body('refreshToken') refreshToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token: string = refreshToken || (req.cookies?.refreshToken as string);
    return this.authService.refreshToken(token, res);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    return this.authService.logout(res);
  }
}
