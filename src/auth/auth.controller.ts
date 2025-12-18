import { Controller, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
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
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.refreshToken(refreshToken, res);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    return this.authService.logout(res);
  }
}
