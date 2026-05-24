import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ImagesController } from './images.controller';
import { ProfileImageController } from './profile-image.controller';
import { CoverImageController } from './cover-image.controller';
import { ProductImagesController } from './product-images.controller';
import { BusinessImageController } from './business-image.controller';
import { ImageProcessorClient } from './image-processor.client';

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
  providers: [ImageProcessorClient],
  exports: [ImageProcessorClient],
})
export class ImagesModule {}
