import type { Request } from 'express';
import {
  MAX_ITEM_IMAGES,
  PanelBusinessImagesController,
} from './panel-business-images.controller';
import type { ImageProcessorClient } from './image-processor.client';
import type { PrismaService } from '../prisma/prisma.service';

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0,
]);
const file = {
  buffer: JPEG,
  size: JPEG.length,
  mimetype: 'image/jpeg',
  originalname: 'a.jpg',
} as Express.Multer.File;

/** ADM-16: photos from the panel, for the business's own listings only. */
describe('panel business images (ADM-16)', () => {
  const owner = {
    id: 'admin-1',
    adminType: 'BUSINESS',
    role: 'BUSINESS_OWNER',
    permissions: [] as string[],
    isActive: true,
    sellerId: 'seller-1',
  };
  const prisma = {
    admin: { findUnique: jest.fn(), findMany: jest.fn() },
    businessMembershipSubscription: { findFirst: jest.fn() },
    businessPlanRule: { findUnique: jest.fn() },
    storeProduct: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    service: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    product: { count: jest.fn() },
  };
  const imageProcessor = {
    upload: jest.fn(() =>
      Promise.resolve({ key: 'product/seller-1/new.webp', url: 'u' }),
    ),
    delete: jest.fn(() => Promise.resolve()),
  };
  const controller = new PanelBusinessImagesController(
    prisma as unknown as PrismaService,
    imageProcessor as unknown as ImageProcessorClient,
  );
  const req = { admin: { adminId: 'admin-1' } } as unknown as Request;
  const product = (images: string[], extra = {}) => ({
    sellerId: 'seller-1',
    images,
    isActive: true,
    deletedAt: null,
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.admin.findUnique.mockResolvedValue(owner);
    prisma.admin.findMany.mockResolvedValue([
      { id: 'admin-1', role: 'BUSINESS_OWNER' },
    ]);
    prisma.businessMembershipSubscription.findFirst.mockResolvedValue({
      businessMembership: { membershipType: 'STARTUP' },
    });
    prisma.businessPlanRule.findUnique.mockResolvedValue({ panelSeats: 1 });
    for (const model of [prisma.product, prisma.storeProduct, prisma.service]) {
      model.count.mockResolvedValue(0);
    }
  });

  it("adds a photo under the business's folder", async () => {
    prisma.storeProduct.findUnique.mockResolvedValue(product(['a']));
    const result = await controller.addImage(file, 'storeProduct', '7', req);
    expect(imageProcessor.upload).toHaveBeenCalledWith(
      file,
      'product',
      'seller-1',
    );
    expect(prisma.storeProduct.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { images: ['a', 'product/seller-1/new.webp'] },
    });
    expect(result.images).toHaveLength(2);
  });

  it("refuses another business's listing, a deleted one, and a full one", async () => {
    prisma.storeProduct.findUnique.mockResolvedValueOnce(
      product([], { sellerId: 'seller-2' }),
    );
    await expect(
      controller.addImage(file, 'storeProduct', '7', req),
    ).rejects.toMatchObject({ response: { code: 'ITEM_NOT_FOUND' } });

    prisma.storeProduct.findUnique.mockResolvedValueOnce(
      product([], { deletedAt: new Date() }),
    );
    await expect(
      controller.addImage(file, 'storeProduct', '7', req),
    ).rejects.toMatchObject({ response: { code: 'ITEM_NOT_FOUND' } });

    prisma.service.findUnique.mockResolvedValueOnce(
      product(Array.from({ length: MAX_ITEM_IMAGES }, (_, i) => `k${i}`)),
    );
    await expect(
      controller.addImage(file, 'service', '7', req),
    ).rejects.toMatchObject({ response: { code: 'TOO_MANY_IMAGES' } });
    expect(imageProcessor.upload).not.toHaveBeenCalled();
  });

  it('refuses platform admins, accounts without the permission and plans without the panel', async () => {
    const tries = [
      { ...owner, adminType: 'PLATFORM', role: 'SUPER_ADMIN' },
      {
        ...owner,
        role: 'BUSINESS_ANALYST',
        permissions: ['VIEW_BUSINESS_ANALYTICS'],
      },
      { ...owner, isActive: false },
    ];
    for (const admin of tries) {
      prisma.admin.findUnique.mockResolvedValueOnce(admin);
      await expect(
        controller.addImage(file, 'storeProduct', '7', req),
      ).rejects.toMatchObject({ response: { code: 'PANEL_FORBIDDEN' } });
    }

    prisma.businessPlanRule.findUnique.mockResolvedValueOnce({ panelSeats: 0 });
    await expect(
      controller.addImage(file, 'storeProduct', '7', req),
    ).rejects.toMatchObject({ response: { code: 'PANEL_FORBIDDEN' } });
    expect(prisma.storeProduct.findUnique).not.toHaveBeenCalled();
  });

  it('lets a member with MANAGE_BUSINESS_PRODUCTS add a photo', async () => {
    prisma.admin.findUnique.mockResolvedValue({
      ...owner,
      role: 'BUSINESS_MANAGER',
      permissions: ['MANAGE_BUSINESS_PRODUCTS'],
    });
    prisma.service.findUnique.mockResolvedValue(product([]));
    await expect(
      controller.addImage(file, 'service', '7', req),
    ).resolves.toMatchObject({ images: ['product/seller-1/new.webp'] });
  });

  it('hides a store product left without photos and deletes the unused file', async () => {
    prisma.storeProduct.findUnique.mockResolvedValue(
      product(['product/seller-1/a.webp']),
    );
    const result = await controller.removeImage(
      'storeProduct',
      '7',
      'product/seller-1/a.webp',
      req,
    );
    expect(prisma.storeProduct.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { images: [], isActive: false },
    });
    expect(imageProcessor.delete).toHaveBeenCalledWith(
      'product/seller-1/a.webp',
    );
    expect(result).toEqual({ images: [], isActive: false });
  });

  it("keeps a removed file another listing still uses, and never deletes outside the business's folder", async () => {
    prisma.service.findUnique.mockResolvedValue(
      product(['product/seller-1/a.webp', 'https://images.ekoru.cl/x.webp']),
    );
    prisma.storeProduct.count.mockResolvedValueOnce(1);
    await controller.removeImage(
      'service',
      '7',
      'product/seller-1/a.webp',
      req,
    );
    await controller.removeImage(
      'service',
      '7',
      'https://images.ekoru.cl/x.webp',
      req,
    );
    expect(imageProcessor.delete).not.toHaveBeenCalled();
    // A service may have no photos, so it stays as it was.
    expect(prisma.service.update).toHaveBeenLastCalledWith({
      where: { id: 7 },
      data: { images: ['product/seller-1/a.webp'] },
    });
  });

  it('moves a photo to the front, and refuses a key the listing does not have', async () => {
    prisma.storeProduct.findUnique.mockResolvedValue(product(['a', 'b', 'c']));
    await expect(
      controller.setCover('storeProduct', '7', 'c', req),
    ).resolves.toMatchObject({ images: ['c', 'a', 'b'] });
    await expect(
      controller.setCover('storeProduct', '7', 'zzz', req),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_NOT_LISTED' } });
  });
});
