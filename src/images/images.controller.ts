import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ImageProcessorClient } from './image-processor.client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtAdminGuard } from '../auth/guards/jwt-admin.guard';
import {
  declaredImageFilter,
  assertRealImage,
  assertOwnsProduct,
  parseNumericId,
  sellerIdOf,
} from './upload-security';

const UPLOAD_OPTIONS = {
  fileFilter: declaredImageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
};

/**
 * Generic upload routes.
 *
 * Every route here writes to object storage, so every route is authenticated.
 * They were previously all open: anyone on the internet could upload 10 MB
 * against an `entityId` of their choosing, overwriting another seller's
 * imagery and running up storage cost.
 */
@Controller('api/images')
export class ImagesController {
  constructor(
    private readonly imageProcessor: ImageProcessorClient,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Catalog/department artwork is a platform asset, not a seller's, so this is
   * staff-only rather than merely signed-in.
   */
  @Post('upload/department')
  @UseGuards(JwtAdminGuard)
  @UseInterceptors(FileInterceptor('image', UPLOAD_OPTIONS))
  async uploadDepartmentImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('entityId') entityId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!entityId) throw new BadRequestException('entityId is required');
    assertRealImage(file);

    const processed = await this.imageProcessor.upload(file, 'asset', entityId);

    return { success: true, key: processed.key, imageUrl: processed.url };
  }

  @Post('upload/product')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image', UPLOAD_OPTIONS))
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('entityId') entityId: string,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!entityId) throw new BadRequestException('entityId is required');
    assertRealImage(file);

    // The product named in the body has to belong to the caller, otherwise a
    // signed-in seller can overwrite anyone's imagery.
    const sellerId = sellerIdOf(req);
    const productId = parseNumericId(entityId, 'entityId');
    await assertOwnsProduct(this.prisma, productId, sellerId);

    const processed = await this.imageProcessor.upload(
      file,
      'product',
      entityId,
    );

    return { success: true, key: processed.key, imageUrl: processed.url };
  }

  /**
   * Avatar upload. The target is always the caller's own account — an
   * `entityId` from the body is ignored, since honouring it would let any
   * seller replace another seller's avatar.
   */
  @Post('upload/user')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image', UPLOAD_OPTIONS))
  async uploadUserImage(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    assertRealImage(file);

    const sellerId = sellerIdOf(req);
    const processed = await this.imageProcessor.upload(
      file,
      'user_avatar',
      sellerId,
    );

    return { success: true, key: processed.key, imageUrl: processed.url };
  }
}
