import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { checkAccessToken, describeAccessToken } from '../access-token';

/**
 * Passport answers every rejected REST request (image uploads and the like)
 * with a bare 401. The app needs no more than that; the log gets the reason.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    if (err || !user) {
      const req = context.switchToHttp().getRequest<Request>();
      const cookies = req.cookies as Record<string, string> | undefined;
      const token =
        cookies?.token ||
        req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
        '';
      const check = checkAccessToken(
        token,
        this.config.getOrThrow<string>('JWT_SECRET'),
        Boolean(cookies?.refreshToken),
      );
      const reason =
        check.status === 'valid'
          ? `${describeAccessToken(check)}, but it is not a seller token`
          : describeAccessToken(check);
      this.logger.warn(
        `401 ${req.method} ${req.originalUrl}: ${reason} | ip ${req.ip}`,
      );
    }
    return super.handleRequest<TUser>(err, user, info, context, status);
  }
}
