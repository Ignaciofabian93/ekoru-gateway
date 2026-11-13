import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessImageController } from './business-image.controller';
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

/** GW-7: the older photo route keeps the 3 photos per listing of the others. */
describe('business image photo limit (GW-7)', () => {
  const prisma = {
    storeProduct: { findUnique: jest.fn(), update: jest.fn() },
    service: { findUnique: jest.fn(), update: jest.fn() },
  };
  const imageProcessor = {
    upload: jest.fn(() =>
      Promise.resolve({ key: 'product/7/new.webp', url: 'u' }),
    ),
  };
  const controller = new BusinessImageController(
    prisma as unknown as PrismaService,
    imageProcessor as unknown as ImageProcessorClient,
  );
  const req = { user: { sellerId: 'seller-1' } } as unknown as Request;
  const listing = (images: string[]) => ({ sellerId: 'seller-1', images });

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['storeProduct', prisma.storeProduct],
    ['service', prisma.service],
  ] as const)(
    'refuses a 4th photo on a %s, before uploading',
    async (itemType, model) => {
      model.findUnique.mockResolvedValue(listing(['a', 'b', 'c']));

      const refusal = await controller
        .uploadBusinessImage(file, '7', itemType, req)
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(BadRequestException);
      expect((refusal as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ code: 'TOO_MANY_IMAGES' }),
      );
      expect(imageProcessor.upload).not.toHaveBeenCalled();
      expect(model.update).not.toHaveBeenCalled();
    },
  );

  it('adds a 3rd photo', async () => {
    prisma.storeProduct.findUnique.mockResolvedValue(listing(['a', 'b']));

    const result = await controller.uploadBusinessImage(
      file,
      '7',
      'storeProduct',
      req,
    );

    expect(result.key).toBe('product/7/new.webp');
    expect(prisma.storeProduct.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { images: ['a', 'b', 'product/7/new.webp'] },
    });
  });
});
