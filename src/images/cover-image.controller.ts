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
import { assertRealImage } from './upload-security';

// Narrower than the shared filter on purpose: covers are rendered large, so
// only the three formats the processor handles well are offered. The declared
// mimetype is still just a hint — `assertRealImage` checks the bytes.
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
    assertRealImage(file);

    const userId = req.user.sellerId;

    const previousKey = await this.findExistingCoverImage(userId);

    const processed = await this.imageProcessor.upload(
      file,
      'user_cover',
      userId,
    );

    await this.updateUserCoverImage(userId, processed.key);
    // Only once the profile points at the new cover is the old one removed,
    // so a failed upload never leaves the profile on a deleted file (GW-3).
    await this.deleteQuietly(previousKey, userId);

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

  private async deleteQuietly(key: string | null, userId: string) {
    if (!key) return;
    try {
      await this.imageProcessor.delete(key);
    } catch (error) {
      this.logger.warn(
        `Failed to delete the old cover image of ${userId}: ${String(error)}`,
      );
    }
  }

  private async findExistingCoverImage(userId: string): Promise<string | null> {
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

      return existingKey;
    } catch (error) {
      this.logger.warn(
        `Failed to read the cover image of ${userId}: ${String(error)}`,
      );
      return null;
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
