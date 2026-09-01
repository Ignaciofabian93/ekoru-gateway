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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtAdminGuard } from '../auth/guards/jwt-admin.guard';
import {
  declaredImageFilter,
  assertRealImage,
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
  constructor(private readonly imageProcessor: ImageProcessorClient) {}

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

  /**
   * Listing imagery, uploaded by the publish wizard *before* the product row
   * exists — the mutation that creates it takes the R2 keys as an argument.
   * So there is no product id to check ownership against, and the namespace
   * comes from the verified token rather than the request body, exactly as
   * `upload/user` below does.
   *
   * That keeps the property the per-product check was there for: a caller can
   * only ever write under their own seller id, and an `entityId` supplied by
   * the client is ignored rather than trusted.
   *
   * This route used to run `assertOwnsProduct` against an `entityId` from the
   * body, which could never pass from the wizard: web sends the seller's UUID
   * (rejected by `parseNumericId`) and mobile sends no field at all, while a
   * genuine product id would have failed the ownership check a line later
   * because the product does not exist yet. Publishing was returning 400 on
   * both clients.
   */
  @Post('upload/product')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image', UPLOAD_OPTIONS))
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    assertRealImage(file);

    const sellerId = sellerIdOf(req);
    const processed = await this.imageProcessor.upload(
      file,
      'product',
      sellerId,
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
