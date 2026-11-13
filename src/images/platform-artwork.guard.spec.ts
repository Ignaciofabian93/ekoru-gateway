import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformArtworkGuard } from './platform-artwork.guard';
import type { PrismaService } from '../prisma/prisma.service';

/** GW-7: platform artwork is for EKORU staff, not for any admin token. */
describe('PlatformArtworkGuard (GW-7)', () => {
  const findUnique = jest.fn();
  const guard = new PlatformArtworkGuard({
    admin: { findUnique },
  } as unknown as PrismaService);
  const context = (admin?: { adminId: string }) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ admin }) }),
    }) as unknown as ExecutionContext;
  const staff = {
    adminType: 'PLATFORM',
    role: 'CONTENT_MANAGER',
    permissions: [] as string[],
    isActive: true,
    accountLocked: false,
  };

  beforeEach(() => findUnique.mockReset());

  it('lets a super admin through', async () => {
    findUnique.mockResolvedValue({ ...staff, role: 'SUPER_ADMIN' });

    await expect(
      guard.canActivate(context({ adminId: 'admin-1' })),
    ).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'admin-1' } }),
    );
  });

  it.each(['MANAGE_CATEGORIES', 'WRITE_BLOG', 'MODERATE_CONTENT'])(
    'lets platform staff with %s through',
    async (permission) => {
      findUnique.mockResolvedValue({ ...staff, permissions: [permission] });

      await expect(
        guard.canActivate(context({ adminId: 'admin-1' })),
      ).resolves.toBe(true);
    },
  );

  it.each([
    [
      "a business's owner",
      { ...staff, adminType: 'BUSINESS', role: 'BUSINESS_OWNER' },
    ],
    [
      'a business admin who holds a platform permission by mistake',
      { ...staff, adminType: 'BUSINESS', permissions: ['MANAGE_CATEGORIES'] },
    ],
    [
      'platform staff with another job',
      { ...staff, permissions: ['PROCESS_REFUNDS'] },
    ],
    [
      'a turned-off account',
      { ...staff, role: 'SUPER_ADMIN', isActive: false },
    ],
    [
      'a locked account',
      { ...staff, role: 'SUPER_ADMIN', accountLocked: true },
    ],
    ['an admin that no longer exists', null],
  ])('refuses %s', async (_label, admin) => {
    findUnique.mockResolvedValue(admin);

    await expect(
      guard.canActivate(context({ adminId: 'admin-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a request the admin guard did not mark', async () => {
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
