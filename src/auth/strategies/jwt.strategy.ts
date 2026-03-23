import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Extract access token cookie only (not refreshToken — it's signed with a different secret)
        (request: Request) => {
          return (request?.cookies?.token as string | undefined) ?? null;
        },
        // Then try Authorization header (used by mobile clients)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'fallback-secret',
    });
  }

  validate(payload: { sellerId: string }) {
    if (!payload || !payload.sellerId) {
      throw new UnauthorizedException();
    }
    return { sellerId: payload.sellerId };
  }
}
