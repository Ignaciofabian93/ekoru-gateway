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
   * Replaces a product's image set and then deletes the replaced files. An
   * unauthenticated caller could once wipe the imagery of any product id they
   * cared to name, so ownership is checked first.
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

    const previous = await this.prisma.product.findUnique({
      where: { id: productIdNum },
      select: { images: true },
    });

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
    // The old set goes only once the product points at the new one (GW-3).
    await this.deleteQuietly(
      (previous?.images ?? []).filter((key) => !keys.includes(key)),
      productIdNum,
    );

    return {
      message: 'Files uploaded successfully',
      keys,
      imageUrls: processedImages.map((p) => p.url),
    };
  }

  private async deleteQuietly(keys: string[], productId: number) {
    try {
      await Promise.all(keys.map((key) => this.imageProcessor.delete(key)));
    } catch (error) {
      this.logger.warn(
        `Failed to delete existing product images for ${productId}: ${String(error)}`,
      );
    }
  }
}
