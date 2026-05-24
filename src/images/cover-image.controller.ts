import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ImageProcessorClient } from './image-processor.client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
  private readonly logger = new Logger(CoverImageController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProcessor: ImageProcessorClient,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadCoverImage(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request & { user: { sellerId: string } },
  ) {
    if (!file) {
      throw new BadRequestException('No file received');
    }

    const userId = req.user.sellerId;

    await this.deleteExistingCoverImage(userId);

    const processed = await this.imageProcessor.upload(
      file,
      'user_cover',
      userId,
    );

    await this.updateUserCoverImage(userId, processed.key);

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

  private async deleteExistingCoverImage(userId: string): Promise<void> {
    try {
      const user = await this.prisma.seller.findUnique({
        where: { id: userId },
        select: { sellerType: true },
      });

      let existingKey: string | null = null;

      if (user?.sellerType === 'PERSON') {
        const personProfile = await this.prisma.personProfile.findFirst({
          where: { sellerId: userId },
          select: { coverImage: true },
        });
        existingKey = personProfile?.coverImage ?? null;
      } else if (
        user?.sellerType === 'STARTUP' ||
        user?.sellerType === 'COMPANY'
      ) {
        const businessProfile = await this.prisma.businessProfile.findFirst({
          where: { sellerId: userId },
          select: { coverImage: true },
        });
        existingKey = businessProfile?.coverImage ?? null;
      }

      if (existingKey) {
        await this.imageProcessor.delete(existingKey);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete existing cover image for ${userId}: ${String(error)}`,
      );
    }
  }

  private async updateUserCoverImage(
    userId: string,
    key: string,
  ): Promise<void> {
    const user = await this.prisma.seller.findUnique({
      where: { id: userId },
      select: { sellerType: true },
    });

    if (user?.sellerType === 'PERSON') {
      await this.prisma.personProfile.update({
        where: { sellerId: userId },
        data: { coverImage: key },
      });
    } else if (
      user?.sellerType === 'STARTUP' ||
      user?.sellerType === 'COMPANY'
    ) {
      await this.prisma.businessProfile.update({
        where: { sellerId: userId },
        data: { coverImage: key },
      });
    }
  }
}
