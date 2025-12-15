import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ImagesController } from './images.controller';
import { ProfileImageController } from './profile-image.controller';
import { CoverImageController } from './cover-image.controller';
import { ProductImagesController } from './product-images.controller';
import { BusinessImageController } from './business-image.controller';
import { ImagesService } from './images.service';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
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
  providers: [ImagesService],
  exports: [ImagesService],
})
export class ImagesModule {}
