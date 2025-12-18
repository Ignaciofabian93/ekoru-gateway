import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../prisma/prisma.service';
import { ImagesService } from './images.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly imagesService: ImagesService,
  ) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 3, {
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
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

    // Delete existing product images
    await this.deleteExistingProductImages(productIdNum);

    // Save new images
    const imagePaths: string[] = [];
    for (const file of files) {
      const fileName =
        'product-' +
        productId +
        '-' +
        Date.now() +
        '-' +
        Math.round(Math.random() * 1e9) +
        '.jpg';
      const imagePath = await this.imagesService.saveFile(
        file.buffer,
        'product-images',
        fileName,
      );
      imagePaths.push(imagePath);
    }

    // Update database
    await this.prisma.product.update({
      where: { id: productIdNum },
      data: { images: imagePaths },
    });

    return {
      message: 'Files uploaded successfully',
      imagePaths,
      imageUrls: imagePaths.map((p) => this.imagesService.getFullUrl(p)),
    };
  }

  private async deleteExistingProductImages(productId: number): Promise<void> {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { images: true },
      });

      if (product?.images && product.images.length > 0) {
        for (const imagePath of product.images) {
          await this.imagesService.deleteFile(imagePath);
        }
      }
    } catch (error) {
      console.error('Error checking/deleting existing product images:', error);
    }
  }
}
