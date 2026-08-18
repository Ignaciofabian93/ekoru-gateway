import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { verify } from 'jsonwebtoken';

/**
 * Requires a valid **admin** access token.
 *
 * `JwtAuthGuard` cannot be used for this: its passport strategy rejects any
 * token without a `sellerId`, and admin tokens carry `adminId` instead. Routes
 * that manage platform-wide assets (catalog imagery, for example) belong to
 * staff, not to a seller, so they need this guard.
 *
 * Only the access-token secret is accepted — a refresh token must not authorize
 * a request, the same rule the GraphQL context follows.
 */
@Injectable()
export class JwtAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token =
      (req.cookies?.token as string | undefined) ||
      req.headers.authorization?.split(' ')[1];

    if (!token)
      throw new UnauthorizedException('Admin authentication required');

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new UnauthorizedException('Auth is not configured');

    let payload: { adminId?: string };
    try {
      payload = verify(token, secret) as { adminId?: string };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload?.adminId) {
      throw new UnauthorizedException('Admin authentication required');
    }

    (req as Request & { admin?: { adminId: string } }).admin = {
      adminId: payload.adminId,
    };
    return true;
  }
}
