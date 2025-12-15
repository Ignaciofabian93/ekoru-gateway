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
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new BadRequestException('Only JPEG, PNG, and WebP images are allowed!'),
      false,
    );
  }
};

@Controller('api/cover-image')
export class CoverImageController {
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
  async uploadCoverImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file received');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    // Delete existing cover image
    await this.deleteExistingCoverImage(userId);

    // Create unique filename
    const fileName = 'cover-' + userId + '-' + Date.now() + '.jpg';
    const imagePath = await this.imagesService.saveFile(
      file.buffer,
      'cover-images',
      fileName,
    );

    // Update database
    await this.updateUserCoverImage(userId, imagePath);

    console.log('Cover image uploaded: ' + fileName + ' for user: ' + userId);

    return {
      message: 'File uploaded and processed successfully',
      imagePath,
      imageUrl: this.imagesService.getFullUrl(imagePath),
      fileName,
      originalSize: file.size,
      processedSize: file.buffer.length,
    };
  }

  private async deleteExistingCoverImage(userId: string): Promise<void> {
    try {
      const user = await this.prisma.seller.findUnique({
        where: { id: userId },
        select: { sellerType: true },
      });

      if (user?.sellerType === 'PERSON') {
        const personProfile = await this.prisma.personProfile.findFirst({
          where: { sellerId: userId },
          select: { coverImage: true },
        });

        if (personProfile?.coverImage) {
          const urlParts = personProfile.coverImage.split('/');
          const existingFileName = urlParts[urlParts.length - 1];
          const existingFilePath = `cover-images/${existingFileName}`;
          await this.imagesService.deleteFile(existingFilePath);
        }
      } else if (
        user?.sellerType === 'STARTUP' ||
        user?.sellerType === 'COMPANY'
      ) {
        const businessProfile = await this.prisma.businessProfile.findFirst({
          where: { sellerId: userId },
          select: { coverImage: true },
        });
        if (businessProfile?.coverImage) {
          const urlParts = businessProfile.coverImage.split('/');
          const existingFileName = urlParts[urlParts.length - 1];
          const existingFilePath = `cover-images/${existingFileName}`;
          await this.imagesService.deleteFile(existingFilePath);
        }
      }
    } catch (error) {
      console.error('Error checking/deleting existing cover image:', error);
    }
  }

  private async updateUserCoverImage(
    userId: string,
    imagePath: string,
  ): Promise<void> {
    const user = await this.prisma.seller.findUnique({
      where: { id: userId },
      select: { sellerType: true },
    });

    if (user?.sellerType === 'PERSON') {
      await this.prisma.personProfile.update({
        where: { sellerId: userId },
        data: { coverImage: imagePath },
      });
    } else if (
      user?.sellerType === 'STARTUP' ||
      user?.sellerType === 'COMPANY'
    ) {
      await this.prisma.businessProfile.update({
        where: { sellerId: userId },
        data: { coverImage: imagePath },
      });
    }
  }
}
