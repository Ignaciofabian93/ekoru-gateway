import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

@Controller('api/business-image')
export class BusinessImageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imagesService: ImagesService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadBusinessImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('itemId') itemId: string,
    @Body('itemType') itemType: string,
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

    // Delete existing business image
    await this.deleteExistingBusinessImage(itemId, itemType);

    // Create unique filename
    const filename = this.imagesService.generateUniqueFilename(
      file.originalname,
      `business-${itemType}-${itemId}`,
    );

    const imagePath = await this.imagesService.saveFile(
      file.buffer,
      'business-images',
      filename,
    );

    // Update business image in database
    await this.updateBusinessImage(itemId, itemType, imagePath);

    const config = this.imagesService.getImagesConfig();
    const imageUrl = `${config.baseUrl}${imagePath}`;

    return {
      message: 'File uploaded and processed successfully',
      imagePath,
      imageUrl,
      fileName: filename,
      originalSize: file.size,
      processedSize: file.buffer.length,
    };
  }

  private async deleteExistingBusinessImage(
    itemId: string,
    itemType: string,
  ): Promise<void> {
    try {
      let existingImages: string[] = [];

      if (itemType === 'storeProduct') {
        const storeProduct = await this.prisma.storeProduct.findUnique({
          where: { id: parseInt(itemId) },
          select: { images: true },
        });
        existingImages = storeProduct?.images || [];
      } else if (itemType === 'service') {
        const service = await this.prisma.service.findUnique({
          where: { id: parseInt(itemId) },
          select: { images: true },
        });
        existingImages = service?.images || [];
      }

      if (existingImages.length > 0) {
        const config = this.imagesService.getImagesConfig();
        const uploadDir = `${config.basePath}/business-images`;

        for (const imageUrl of existingImages) {
          const urlParts = imageUrl.split('/');
          const existingFileName = urlParts[urlParts.length - 1];
          const existingFilePath = `${uploadDir}/${existingFileName}`;

          try {
            await this.imagesService.deleteFile(existingFilePath);
          } catch (error) {
            console.warn(
              `Could not delete existing business image ${existingFileName}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.error('Error checking/deleting existing business images:', error);
    }
  }

  private async updateBusinessImage(
    itemId: string,
    itemType: string,
    imagePath: string,
  ): Promise<void> {
    try {
      if (itemType === 'storeProduct') {
        const storeProduct = await this.prisma.storeProduct.findUnique({
          where: { id: parseInt(itemId) },
          select: { images: true },
        });

        if (storeProduct) {
          const updatedImages = [...(storeProduct.images || []), imagePath];

          await this.prisma.storeProduct.update({
            where: { id: parseInt(itemId) },
            data: { images: updatedImages },
          });
        } else {
          console.warn(`No StoreProduct found for itemId: ${itemId}`);
          throw new BadRequestException('Store product not found');
        }
      } else if (itemType === 'service') {
        const service = await this.prisma.service.findUnique({
          where: { id: parseInt(itemId) },
          select: { images: true },
        });

        if (service) {
          const updatedImages = [...(service.images || []), imagePath];

          await this.prisma.service.update({
            where: { id: parseInt(itemId) },
            data: { images: updatedImages },
          });
        } else {
          console.warn(`No Service found for itemId: ${itemId}`);
          throw new BadRequestException('Service not found');
        }
      } else {
        throw new BadRequestException(`Invalid item type: ${itemType}`);
      }
    } catch (error) {
      console.error('Database update error:', error);
      throw new BadRequestException(
        'Failed to update business image in database',
      );
    }
  }
}
