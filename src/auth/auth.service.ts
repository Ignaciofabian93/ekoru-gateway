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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string, res: Response) {
    const formattedEmail = email.toLowerCase();
    const user = await this.prisma.seller.findUnique({
      where: { email: formattedEmail },
    });

    if (!user) {
      throw new BadRequestException('No se encontró al usuario');
    }

    const valid = await compare(password, user.password);
    if (!valid) {
      throw new BadRequestException('Credenciales inválidas');
    }

    const token = this.jwtService.sign(
      { sellerId: user.id },
      { expiresIn: '15m' },
    );

    const refreshToken = this.jwtService.sign(
      { sellerId: user.id },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      },
    );

    const environment = this.configService.get<string>(
      'ENVIRONMENT',
      'development',
    );
    const isSecure = environment === 'production' || environment === 'qa';
    const domain = isSecure ? '.ekoru.cl' : undefined;

    // Always use httpOnly for security
    res.cookie('token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'strict' : 'lax',
      maxAge: 15 * 60 * 1000, // 15 minutes
      domain,
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      domain,
    });

    return { token, message: 'Inicio de sesión exitoso' };
  }

  refreshToken(refreshToken: string, res: Response) {
    if (!refreshToken) {
      throw new UnauthorizedException(
        'No se pudo generar un nuevo token de acceso',
      );
    }

    try {
      const payload: { sellerId: string } = this.jwtService.verify(
        refreshToken,
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET') },
      );

      const newToken = this.jwtService.sign(
        { sellerId: payload.sellerId },
        { expiresIn: '15m' },
      );

      const environment = this.configService.get<string>(
        'ENVIRONMENT',
        'development',
      );
      const isSecure = environment === 'production' || environment === 'qa';
      const domain = isSecure ? '.ekoru.cl' : undefined;

      res.cookie('token', newToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: isSecure ? 'strict' : 'lax',
        maxAge: 15 * 60 * 1000,
        domain,
      });

      return { token: newToken, success: true };
    } catch {
      throw new UnauthorizedException('Token de acceso inválido');
    }
  }

  decodeToken(token: string): { sellerId: string } | null {
    if (!token) {
      return null;
    }

    // First try to decode with regular JWT secret
    try {
      const decoded: { sellerId: string } = this.jwtService.verify(token);
      return decoded;
    } catch {
      console.error(
        'Failed to decode with regular secret, trying refresh secret',
      );
    }

    // If regular JWT fails, try with refresh JWT secret
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

  logout(res: Response) {
    const environment = this.configService.get<string>(
      'ENVIRONMENT',
      'development',
    );
    const isSecure = environment === 'production' || environment === 'qa';
    const domain = isSecure ? '.ekoru.cl' : undefined;

    // Clear both cookies
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

    return { success: true, message: 'Sesión cerrada exitosamente' };
  }
}
