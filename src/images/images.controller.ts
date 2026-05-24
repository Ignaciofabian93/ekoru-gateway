import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageProcessorClient } from './image-processor.client';

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

@Controller('api/images')
export class ImagesController {
  constructor(private readonly imageProcessor: ImageProcessorClient) {}

  @Post('upload/department')
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDepartmentImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('entityId') entityId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }

    const processed = await this.imageProcessor.upload(file, 'asset', entityId);

    return {
      success: true,
      key: processed.key,
      imageUrl: processed.url,
    };
  }

  @Post('upload/product')
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('entityId') entityId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }

    const processed = await this.imageProcessor.upload(
      file,
      'product',
      entityId,
    );

    return {
      success: true,
      key: processed.key,
      imageUrl: processed.url,
    };
  }

  @Post('upload/user')
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadUserImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('entityId') entityId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }

    const processed = await this.imageProcessor.upload(
      file,
      'user_avatar',
      entityId,
    );

    return {
      success: true,
      key: processed.key,
      imageUrl: processed.url,
    };
  }
}
