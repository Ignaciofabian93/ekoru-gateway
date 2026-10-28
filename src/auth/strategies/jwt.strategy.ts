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
      // No default: a known fallback would let anyone sign a token we accept.
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: { sellerId: string }) {
    if (!payload || !payload.sellerId) {
      throw new UnauthorizedException();
    }
    return { sellerId: payload.sellerId };
  }
}
