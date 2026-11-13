import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The permissions whose screens upload platform artwork: catalog images
 * (MANAGE_CATEGORIES), blog covers (WRITE_BLOG) and community event covers
 * (MODERATE_CONTENT). The same permissions gate those screens' mutations in
 * the subgraphs.
 */
const ARTWORK_PERMISSIONS = [
  'MANAGE_CATEGORIES',
  'WRITE_BLOG',
  'MODERATE_CONTENT',
] as const;

/**
 * Lets only EKORU staff upload platform artwork (GW-7). Runs after
 * `JwtAdminGuard`, which proves who the admin is but not what they may do: any
 * admin token passed it, a business's panel accounts included, so a business
 * could write files into the platform's own folders.
 *
 * As a guard it answers before multer reads the file. The account is read on
 * every request, so a turned-off admin or a revoked permission stops at once.
 */
@Injectable()
export class PlatformArtworkGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { admin?: { adminId: string } }>();
    const adminId = req.admin?.adminId;
    const admin = adminId
      ? await this.prisma.admin.findUnique({
          where: { id: adminId },
          select: {
            adminType: true,
            role: true,
            permissions: true,
            isActive: true,
            accountLocked: true,
          },
        })
      : null;

    const allowed =
      !!admin &&
      admin.isActive &&
      !admin.accountLocked &&
      admin.adminType === 'PLATFORM' &&
      (admin.role === 'SUPER_ADMIN' ||
        admin.permissions.some((permission) =>
          (ARTWORK_PERMISSIONS as readonly string[]).includes(permission),
        ));

    if (!allowed) {
      throw new ForbiddenException(
        'Only EKORU staff who manage the catalog, the blog or community events can upload this image',
      );
    }
    return true;
  }
}
