import { businessPanelRefusal } from './business-panel-access';
import type { PrismaService } from '../prisma/prisma.service';

const NOW = new Date('2026-11-03T12:00:00Z');

function setup({
  plan,
  seats,
  holders = [],
}: {
  plan?: string;
  seats?: number;
  holders?: { id: string; role: string }[];
}) {
  const prisma = {
    businessMembershipSubscription: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          plan ? { businessMembership: { membershipType: plan } } : null,
        ),
    },
    businessPlanRule: {
      findUnique: jest
        .fn()
        .mockResolvedValue(seats === undefined ? null : { panelSeats: seats }),
    },
    admin: { findMany: jest.fn().mockResolvedValue(holders) },
  };
  return { prisma, db: prisma as unknown as PrismaService };
}

describe('businessPanelRefusal (USR-15)', () => {
  it('refuses a business on the free plan', async () => {
    const { prisma, db } = setup({ seats: 0 });

    await expect(
      businessPanelRefusal(db, { id: 'a1', sellerId: 'store-1' }, NOW),
    ).resolves.toBe('not-in-plan');
    expect(prisma.businessPlanRule.findUnique).toHaveBeenCalledWith({
      where: { plan: 'FREEMIUM' },
      select: { panelSeats: true },
    });
    expect(prisma.admin.findMany).not.toHaveBeenCalled();
  });

  it('reads the plan in force, not a queued one', async () => {
    const { prisma, db } = setup({
      plan: 'BASIC',
      seats: 2,
      holders: [{ id: 'a1', role: 'BUSINESS_OWNER' }],
    });

    await expect(
      businessPanelRefusal(db, { id: 'a1', sellerId: 'store-1' }, NOW),
    ).resolves.toBeNull();
    expect(
      prisma.businessMembershipSubscription.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sellerId: 'store-1',
          isActive: true,
          startDate: { lte: NOW },
          OR: [{ endDate: null }, { endDate: { gt: NOW } }],
        },
      }),
    );
  });

  it('seats the owner first, then the oldest accounts', async () => {
    // Oldest first, as the query orders them; the owner joined later.
    const holders = [
      { id: 'old', role: 'BUSINESS_MANAGER' },
      { id: 'newer', role: 'BUSINESS_SUPPORT' },
      { id: 'owner', role: 'BUSINESS_OWNER' },
    ];
    const { db } = setup({ plan: 'STARTUP', seats: 2, holders });
    const check = (id: string) =>
      businessPanelRefusal(db, { id, sellerId: 'store-1' }, NOW);

    await expect(check('owner')).resolves.toBeNull();
    await expect(check('old')).resolves.toBeNull();
    await expect(check('newer')).resolves.toBe('no-seat');
  });

  it('refuses an admin with no business', async () => {
    const { db } = setup({ plan: 'EXPERT', seats: 5 });

    await expect(
      businessPanelRefusal(db, { id: 'a1', sellerId: null }, NOW),
    ).resolves.toBe('not-in-plan');
  });
});
