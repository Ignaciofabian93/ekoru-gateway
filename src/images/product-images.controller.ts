import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ImageProcessorClient } from './image-processor.client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  declaredImageFilter,
  assertRealImage,
  assertOwnsProduct,
  parseNumericId,
  sellerIdOf,
} from './upload-security';

@Controller('api/product-images')
export class ProductImagesController {
  private readonly logger = new Logger(ProductImagesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProcessor: ImageProcessorClient,
  ) {}

  /**
   * Replaces a product's image set. This deletes the existing images before
   * writing the new ones, so an unauthenticated caller could previously wipe
   * the imagery of any product id they cared to name.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('files', 3, {
      fileFilter: declaredImageFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadProductImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('productId') productId: string,
    @Req() req: Request,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files received');
    }

    if (!productId) {
      throw new BadRequestException('Product ID is required');
    }

    files.forEach(assertRealImage);

    const sellerId = sellerIdOf(req);
    const productIdNum = parseNumericId(productId, 'productId');
    // Ownership is checked before anything is deleted.
    await assertOwnsProduct(this.prisma, productIdNum, sellerId);

    await this.deleteExistingProductImages(productIdNum);

    const processedImages = await Promise.all(
      files.map((file) =>
        this.imageProcessor.upload(file, 'product', productId),
      ),
    );

    const keys = processedImages.map((p) => p.key);

    await this.prisma.product.update({
      where: { id: productIdNum },
      data: { images: keys },
    });

    return {
      message: 'Files uploaded successfully',
      keys,
      imageUrls: processedImages.map((p) => p.url),
    };
  }

  private async deleteExistingProductImages(productId: number): Promise<void> {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { images: true },
      });

      if (product?.images && product.images.length > 0) {
        await Promise.all(
          product.images.map((key) => this.imageProcessor.delete(key)),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete existing product images for ${productId}: ${String(error)}`,
      );
    }
  }
}
