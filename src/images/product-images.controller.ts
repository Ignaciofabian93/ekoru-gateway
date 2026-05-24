import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../prisma/prisma.service';
import { ImageProcessorClient } from './image-processor.client';

const imageFileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new BadRequestException('Only image files are allowed!'), false);
  }
};

@Controller('api/product-images')
export class ProductImagesController {
  private readonly logger = new Logger(ProductImagesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProcessor: ImageProcessorClient,
  ) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 3, {
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadProductImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('productId') productId: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files received');
    }

    if (!productId) {
      throw new BadRequestException('Product ID is required');
    }

    const productIdNum = parseInt(productId, 10);

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
