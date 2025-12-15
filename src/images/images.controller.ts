import {
  Controller,
  Post,
  Get,
  Param,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ImagesService } from './images.service';
import * as fs from 'fs';
import * as path from 'path';

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
  constructor(private readonly imagesService: ImagesService) {}

  @Post('upload/department')
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadDepartmentImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const filename = this.imagesService.generateUniqueFilename(
      file.originalname,
      'department',
    );
    const imagePath = await this.imagesService.saveFile(
      file.buffer,
      'departments',
      filename,
    );

    return {
      success: true,
      imagePath,
      imageUrl: this.imagesService.getFullUrl(imagePath),
    };
  }

  @Post('upload/product')
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadProductImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const filename = this.imagesService.generateUniqueFilename(
      file.originalname,
      'product',
    );
    const imagePath = await this.imagesService.saveFile(
      file.buffer,
      'products',
      filename,
    );

    return {
      success: true,
      imagePath,
      imageUrl: this.imagesService.getFullUrl(imagePath),
    };
  }

  @Post('upload/user')
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadUserImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const filename = this.imagesService.generateUniqueFilename(
      file.originalname,
      'user',
    );
    const imagePath = await this.imagesService.saveFile(
      file.buffer,
      'users',
      filename,
    );

    return {
      success: true,
      imagePath,
      imageUrl: this.imagesService.getFullUrl(imagePath),
    };
  }

  @Get(':category/:filename')
  getImage(
    @Param('category') category: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const config = this.imagesService.getImagesConfig();
    const imagePath = path.join(config.basePath, category, filename);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    return res.sendFile(imagePath);
  }
}
