import type { PrismaService } from '../prisma/prisma.service';

/** Why a business admin can't use the panel. */
export type PanelRefusal = 'not-in-plan' | 'no-seat';

/**
 * Whether a business admin may use the panel (USR-15), checked at login and on
 * every refresh, so a lapsed plan ends sessions within the access token's 15
 * minutes. The panel comes with a paid business plan: the plan in force names
 * its seats in BusinessPlanRule, and 0 (the free plan, or no plan) means no
 * panel. ekoru-users already refuses an admin past the seats
 * (`src/subscription/panel-seats.ts` there), but a lower plan or an edited
 * rule can leave a business with more admins than seats. Then the owner goes
 * first, then the oldest accounts, and the rest wait for a free seat.
 */
export async function businessPanelRefusal(
  prisma: PrismaService,
  admin: { id: string; sellerId: string | null },
  now: Date = new Date(),
): Promise<PanelRefusal | null> {
  if (!admin.sellerId) return 'not-in-plan';

  const term = await prisma.businessMembershipSubscription.findFirst({
    where: {
      sellerId: admin.sellerId,
      isActive: true,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gt: now } }],
    },
    orderBy: { startDate: 'desc' },
    select: { businessMembership: { select: { membershipType: true } } },
  });
  const rule = await prisma.businessPlanRule.findUnique({
    where: { plan: term?.businessMembership.membershipType ?? 'FREEMIUM' },
    select: { panelSeats: true },
  });
  const seats = rule?.panelSeats ?? 0;
  if (seats <= 0) return 'not-in-plan';

  const holders = await prisma.admin.findMany({
    where: { sellerId: admin.sellerId, adminType: 'BUSINESS', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true },
  });
  const queue = [
    ...holders.filter((h) => h.role === 'BUSINESS_OWNER'),
    ...holders.filter((h) => h.role !== 'BUSINESS_OWNER'),
  ];
  const place = queue.findIndex((h) => h.id === admin.id);
  return place >= 0 && place < seats ? null : 'no-seat';
}

/** The message key the login and refresh answers use for each refusal. */
export const PANEL_REFUSAL_MESSAGE: Record<PanelRefusal, string> = {
  'not-in-plan': 'auth.panel_not_in_plan',
  'no-seat': 'auth.panel_no_seat',
};
