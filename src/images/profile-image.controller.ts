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
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new BadRequestException('Only image files are allowed!'), false);
  }
};

@Controller('api/profile-image')
export class ProfileImageController {
  private readonly logger = new Logger(ProfileImageController.name);

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
  async uploadProfileImage(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request & { user: { sellerId: string } },
  ) {
    if (!file) {
      throw new BadRequestException('No file received');
    }

    const userId = req.user.sellerId;

    await this.deleteExistingProfileImage(userId);

    const processed = await this.imageProcessor.upload(
      file,
      'user_avatar',
      userId,
    );

    await this.updateUserProfileImage(userId, processed.key);

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

  private async deleteExistingProfileImage(userId: string): Promise<void> {
    try {
      const user = await this.prisma.seller.findUnique({
        where: { id: userId },
        select: { sellerType: true },
      });

      let existingKey: string | null = null;

      if (user?.sellerType === 'PERSON') {
        const personProfile = await this.prisma.personProfile.findFirst({
          where: { sellerId: userId },
          select: { profileImage: true },
        });
        existingKey = personProfile?.profileImage ?? null;
      } else if (
        user?.sellerType === 'STARTUP' ||
        user?.sellerType === 'COMPANY'
      ) {
        const businessProfile = await this.prisma.businessProfile.findFirst({
          where: { sellerId: userId },
          select: { logo: true },
        });
        existingKey = businessProfile?.logo ?? null;
      }

      if (existingKey) {
        await this.imageProcessor.delete(existingKey);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete existing profile image for ${userId}: ${String(error)}`,
      );
    }
  }

  private async updateUserProfileImage(
    userId: string,
    key: string,
  ): Promise<void> {
    const user = await this.prisma.seller.findUnique({
      where: { id: userId },
      select: { sellerType: true },
    });

    if (user?.sellerType === 'PERSON') {
      const personProfile = await this.prisma.personProfile.findFirst({
        where: { sellerId: userId },
      });

      if (personProfile) {
        await this.prisma.personProfile.update({
          where: { sellerId: userId },
          data: { profileImage: key },
        });
      } else {
        throw new BadRequestException('User profile not found');
      }
    } else if (
      user?.sellerType === 'STARTUP' ||
      user?.sellerType === 'COMPANY'
    ) {
      const businessProfile = await this.prisma.businessProfile.findFirst({
        where: { sellerId: userId },
      });

      if (businessProfile) {
        await this.prisma.businessProfile.update({
          where: { sellerId: userId },
          data: { logo: key },
        });
      }
    }
  }
}
