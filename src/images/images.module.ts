import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ImagesController } from './images.controller';
import { ProfileImageController } from './profile-image.controller';
import { CoverImageController } from './cover-image.controller';
import { ProductImagesController } from './product-images.controller';
import { BusinessImageController } from './business-image.controller';
import { ImageProcessorClient } from './image-processor.client';
import { JwtAdminGuard } from '../auth/guards/jwt-admin.guard';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB — matches MAX_UPLOAD_BYTES in image-processor
      },
    }),
  ],
  controllers: [
    ImagesController,
    ProfileImageController,
    CoverImageController,
    ProductImagesController,
    BusinessImageController,
  ],
  providers: [ImageProcessorClient, JwtAdminGuard],
  exports: [ImageProcessorClient],
})
export class ImagesModule {}
