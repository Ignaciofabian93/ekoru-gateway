import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';

@Injectable()
export class TokenService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Verifies and decodes a JWT token
   * @param token - JWT token to verify
   * @param useRefreshSecret - Whether to use refresh token secret (default: false)
   * @returns Decoded payload or null if invalid/expired
   */
  private verifyToken(
    token: string,
    useRefreshSecret = false,
  ): { sellerId: string; iat?: number; exp?: number } | null {
    if (!token) {
      return null;
    }

    try {
      const secret = useRefreshSecret
        ? this.configService.get<string>('JWT_REFRESH_SECRET')
        : this.configService.get<string>('JWT_SECRET');

      if (!secret) {
        console.error('JWT secret not configured');
        return null;
      }

      const decoded = verify(token, secret) as {
        sellerId: string;
        iat?: number;
        exp?: number;
      };

      return decoded && decoded.sellerId ? decoded : null;
    } catch {
      // Token is invalid or expired
      return null;
    }
  }

  /**
   * Extracts and validates sellerId from token
   * Tries access token first, then refresh token
   */
  getSellerIdFromToken(token: string): string | null {
    // Try verifying as access token
    let decoded = this.verifyToken(token, false);

    // If access token fails, try as refresh token
    if (!decoded) {
      decoded = this.verifyToken(token, true);
    }

    return decoded ? decoded.sellerId : null;
  }

  /**
   * Validates if a token is still valid (not expired)
   */
  isTokenValid(token: string, useRefreshSecret = false): boolean {
    return this.verifyToken(token, useRefreshSecret) !== null;
  }
}
