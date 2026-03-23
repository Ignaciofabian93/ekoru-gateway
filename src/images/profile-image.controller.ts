import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ImagesService } from './images.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly imagesService: ImagesService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
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

    // Delete existing profile image
    await this.deleteExistingProfileImage(userId);

    // Create unique filename
    const fileName = 'profile-' + userId + '-' + Date.now() + '.jpg';
    const imagePath = await this.imagesService.saveFile(
      file.buffer,
      'profile-images',
      fileName,
    );
    console.log('NAME:: ', fileName);
    console.log('PATH:: ', imagePath);

    // Update database
    await this.updateUserProfileImage(userId, imagePath);

    console.log('RETURN:: ', {
      message: 'File uploaded and processed successfully',
      imagePath,
      imageUrl: this.imagesService.getFullUrl(imagePath),
      fileName,
      originalSize: file.size,
      processedSize: file.buffer.length,
    });

    return {
      message: 'File uploaded and processed successfully',
      imagePath,
      imageUrl: this.imagesService.getFullUrl(imagePath),
      fileName,
      originalSize: file.size,
      processedSize: file.buffer.length,
    };
  }

  private async deleteExistingProfileImage(userId: string): Promise<void> {
    try {
      const user = await this.prisma.seller.findUnique({
        where: { id: userId },
        select: { sellerType: true },
      });

      if (user?.sellerType === 'PERSON') {
        const personProfile = await this.prisma.personProfile.findFirst({
          where: { sellerId: userId },
          select: { profileImage: true },
        });

        if (personProfile?.profileImage) {
          const urlParts = personProfile.profileImage.split('/');
          const existingFileName = urlParts[urlParts.length - 1];
          const existingFilePath = `profile-images/${existingFileName}`;
          await this.imagesService.deleteFile(existingFilePath);
        }
      } else if (
        user?.sellerType === 'STARTUP' ||
        user?.sellerType === 'COMPANY'
      ) {
        const businessProfile = await this.prisma.businessProfile.findFirst({
          where: { sellerId: userId },
          select: { logo: true },
        });
        if (businessProfile?.logo) {
          const urlParts = businessProfile.logo.split('/');
          const existingFileName = urlParts[urlParts.length - 1];
          const existingFilePath = `profile-images/${existingFileName}`;
          await this.imagesService.deleteFile(existingFilePath);
        }
      }
    } catch (error) {
      console.error('Error checking/deleting existing profile image:', error);
    }
  }

  private async updateUserProfileImage(
    userId: string,
    imagePath: string,
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
          data: { profileImage: imagePath },
        });
      } else {
        console.warn('No PersonProfile found for sellerId: ' + userId);
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
          data: { logo: imagePath },
        });
      }
    }
  }
}
