// TypeScript-ESLint's project service cannot instantiate Prisma 7's complex delegate
// generics when accessed through a subclass, producing false-positive "error type"
// diagnostics. All types are verified correct by `tsc --noEmit`.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    token: string,
    userId: string,
    userType: 'seller' | 'admin',
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.refreshToken.create({
      data: { token, userId, userType, expiresAt },
    });
  }

  /**
   * Returns true if the token does not exist in the DB or has been explicitly revoked.
   * Unknown tokens (not issued by this server) are treated as revoked.
   */
  async isRevoked(token: string): Promise<boolean> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token },
    });
    if (!record) return true;
    return record.isRevoked;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  /** Revoke all active refresh tokens for a user (logout from all devices). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  }
}
