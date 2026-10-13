import type { Request } from 'express';
import { ImagesController } from './images.controller';
import { ProfileImageController } from './profile-image.controller';
import { ImageProcessorClient } from './image-processor.client';
import { PrismaService } from '../prisma/prisma.service';

/** GW-3: replaced images are deleted, and only when it is safe. */
describe('replaced images (GW-3)', () => {
  const calls: string[] = [];
  const imageProcessor = {
    upload: jest.fn(() => {
      calls.push('upload');
      return Promise.resolve({
        key: 'user_avatar/seller-1/new.webp',
        url: 'u',
      });
    }),
    delete: jest.fn((key: string) => {
      calls.push(`delete ${key}`);
      return Promise.resolve();
    }),
  };
  const prisma = {
    product: { count: jest.fn() },
    storeProduct: { count: jest.fn() },
    service: { count: jest.fn() },
    seller: { findUnique: jest.fn() },
    personProfile: {
      findFirst: jest.fn(),
      update: jest.fn(() => {
        calls.push('save');
        return Promise.resolve({});
      }),
    },
  };
  const req = { user: { sellerId: 'seller-1' } } as unknown as Request;

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
    for (const model of [prisma.product, prisma.storeProduct, prisma.service]) {
      model.count.mockResolvedValue(0);
    }
  });

  describe('release', () => {
    const controller = new ImagesController(
      prisma as unknown as PrismaService,
      imageProcessor as unknown as ImageProcessorClient,
    );

    it("deletes the caller's own keys that no listing uses", async () => {
      const result = await controller.releaseImages(
        ['product/seller-1/a.webp', 'product/seller-1/a.webp'],
        req,
      );
      expect(result).toEqual({ deleted: 1 });
      expect(imageProcessor.delete).toHaveBeenCalledWith(
        'product/seller-1/a.webp',
      );
    });

    it("leaves other sellers' keys, odd paths and keys still listed", async () => {
      prisma.storeProduct.count.mockImplementation(
        ({ where }: { where: { images: { has: string } } }) =>
          Promise.resolve(
            where.images.has === 'product/seller-1/live.webp' ? 1 : 0,
          ),
      );
      const result = await controller.releaseImages(
        [
          'product/seller-2/a.webp',
          'product/seller-1/x/../../seller-2/a.webp',
          'user_avatar/seller-1/a.webp',
          'product/seller-1/live.webp',
          42,
        ],
        req,
      );
      expect(result).toEqual({ deleted: 0 });
      expect(imageProcessor.delete).not.toHaveBeenCalled();
    });

    it('refuses a body without a list', async () => {
      await expect(controller.releaseImages('nope', req)).rejects.toThrow(
        'keys must be a list',
      );
    });
  });

  describe('profile image', () => {
    const controller = new ProfileImageController(
      prisma as unknown as PrismaService,
      imageProcessor as unknown as ImageProcessorClient,
    );
    const file = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]),
      mimetype: 'image/jpeg',
      originalname: 'a.jpg',
      size: 12,
    } as Express.Multer.File;
    const avatarReq = req as Request & { user: { sellerId: string } };

    beforeEach(() => {
      prisma.seller.findUnique.mockResolvedValue({ sellerType: 'PERSON' });
      prisma.personProfile.findFirst.mockResolvedValue({
        id: 'p1',
        profileImage: 'user_avatar/seller-1/old.webp',
      });
    });

    it('deletes the old image only after the new one is saved', async () => {
      await controller.uploadProfileImage(file, avatarReq);
      expect(calls).toEqual([
        'upload',
        'save',
        'delete user_avatar/seller-1/old.webp',
      ]);
    });

    it('keeps the old image when the upload fails', async () => {
      imageProcessor.upload.mockRejectedValueOnce(new Error('processor down'));
      await expect(
        controller.uploadProfileImage(file, avatarReq),
      ).rejects.toThrow('processor down');
      expect(imageProcessor.delete).not.toHaveBeenCalled();
    });
  });
});
