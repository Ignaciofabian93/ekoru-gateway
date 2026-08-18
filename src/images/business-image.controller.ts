import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ImageEntity, ImageProcessorClient } from './image-processor.client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  declaredImageFilter,
  assertRealImage,
  assertOwnsStoreProduct,
  assertOwnsService,
  parseNumericId,
  sellerIdOf,
} from './upload-security';

@Controller('api/business-image')
export class BusinessImageController {
  private readonly logger = new Logger(BusinessImageController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProcessor: ImageProcessorClient,
  ) {}

  /**
   * Adds an image to a store product or a service. Both are seller-owned rows
   * and the existing imagery is deleted first, so the caller must own the row
   * named in `itemId` — checked before any deletion happens.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: declaredImageFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadBusinessImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('itemId') itemId: string,
    @Body('itemType') itemType: string,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file received');
    }

    if (!itemId) {
      throw new BadRequestException('Item ID is required');
    }

    if (!itemType || !['storeProduct', 'service'].includes(itemType)) {
      throw new BadRequestException(
        'Item type is required (storeProduct or service)',
      );
    }

    assertRealImage(file);

    const sellerId = sellerIdOf(req);
    const numericItemId = parseNumericId(itemId, 'itemId');
    if (itemType === 'storeProduct') {
      await assertOwnsStoreProduct(this.prisma, numericItemId, sellerId);
    } else {
      await assertOwnsService(this.prisma, numericItemId, sellerId);
    }

    await this.deleteExistingBusinessImages(itemId, itemType);

    const entity: ImageEntity = itemType === 'service' ? 'service' : 'product';
    const processed = await this.imageProcessor.upload(file, entity, itemId);

    await this.updateBusinessImage(itemId, itemType, processed.key);

    return {
      message: 'File uploaded and processed successfully',
      key: processed.key,
      imageUrl: processed.url,
      originalSize: processed.original_size,
      processedSize: processed.processed_size,
      width: processed.width,
      height: processed.height,
    };
  }

  private async deleteExistingBusinessImages(
    itemId: string,
    itemType: string,
  ): Promise<void> {
    try {
      let existingKeys: string[] = [];

      if (itemType === 'storeProduct') {
        const storeProduct = await this.prisma.storeProduct.findUnique({
          where: { id: parseInt(itemId) },
          select: { images: true },
        });
        existingKeys = storeProduct?.images || [];
      } else if (itemType === 'service') {
        const service = await this.prisma.service.findUnique({
          where: { id: parseInt(itemId) },
          select: { images: true },
        });
        existingKeys = service?.images || [];
      }

      if (existingKeys.length > 0) {
        await Promise.all(
          existingKeys.map((key) => this.imageProcessor.delete(key)),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete existing ${itemType} images for ${itemId}: ${String(error)}`,
      );
    }
  }

  private async updateBusinessImage(
    itemId: string,
    itemType: string,
    key: string,
  ): Promise<void> {
    try {
      if (itemType === 'storeProduct') {
        const storeProduct = await this.prisma.storeProduct.findUnique({
          where: { id: parseInt(itemId) },
          select: { images: true },
        });

        if (storeProduct) {
          const updatedImages = [...(storeProduct.images || []), key];

          await this.prisma.storeProduct.update({
            where: { id: parseInt(itemId) },
            data: { images: updatedImages },
          });
        } else {
          throw new BadRequestException('Store product not found');
        }
      } else if (itemType === 'service') {
        const service = await this.prisma.service.findUnique({
          where: { id: parseInt(itemId) },
          select: { images: true },
        });

        if (service) {
          const updatedImages = [...(service.images || []), key];

          await this.prisma.service.update({
            where: { id: parseInt(itemId) },
            data: { images: updatedImages },
          });
        } else {
          throw new BadRequestException('Service not found');
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Database update error: ${String(error)}`);
      throw new BadRequestException(
        'Failed to update business image in database',
      );
    }
  }
}
