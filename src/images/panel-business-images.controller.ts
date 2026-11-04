import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ImageProcessorClient } from './image-processor.client';
import { JwtAdminGuard } from '../auth/guards/jwt-admin.guard';
import { businessPanelRefusal } from '../auth/business-panel-access';
import {
  declaredImageFilter,
  assertRealImage,
  parseNumericId,
} from './upload-security';

/** The web's limit per listing (`MAX_PRODUCT_IMAGES` there). */
export const MAX_ITEM_IMAGES = 3;

type ItemType = 'storeProduct' | 'service';

interface Item {
  images: string[];
  isActive: boolean;
}

/**
 * Why the panel refused, for the panel to word in the admin's language. The
 * message stays in English for logs, as on the other upload routes.
 */
type PanelImageRefusal =
  | 'PANEL_FORBIDDEN'
  | 'ITEM_NOT_FOUND'
  | 'TOO_MANY_IMAGES'
  | 'IMAGE_NOT_LISTED';

function refused(
  code: PanelImageRefusal,
  message: string,
): BadRequestException | ForbiddenException {
  const body = { code, message };
  return code === 'PANEL_FORBIDDEN'
    ? new ForbiddenException({ statusCode: 403, error: 'Forbidden', ...body })
    : new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        ...body,
      });
}

function parseItemType(raw: unknown): ItemType {
  if (raw === 'storeProduct' || raw === 'service') return raw;
  throw new BadRequestException('itemType must be storeProduct or service');
}

/**
 * Photos for a business's store products and services, from the panel
 * (ADM-16). A spreadsheet can't carry photos, and a store product without one
 * is saved hidden, so this is what lets a catalog go live without the web.
 *
 * Only a business admin who manages the catalog (the owner, or a holder of
 * MANAGE_BUSINESS_PRODUCTS) of a business whose plan includes the panel, and
 * only on the business's own rows. Files go under the same
 * `product/<sellerId>/` folder the web's uploads use, so its release route
 * and the listing pages treat them alike.
 */
@Controller('api/panel/business-images')
@UseGuards(JwtAdminGuard)
export class PanelBusinessImagesController {
  private readonly logger = new Logger(PanelBusinessImagesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageProcessor: ImageProcessorClient,
  ) {}

  /** Adds one photo at the end of the item's list. */
  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: declaredImageFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async addImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('itemType') rawType: unknown,
    @Body('itemId') rawId: string,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const itemType = parseItemType(rawType);
    const itemId = parseNumericId(rawId, 'itemId');
    const sellerId = await this.catalogSeller(req);
    const item = await this.loadItem(itemType, itemId, sellerId);
    if (item.images.length >= MAX_ITEM_IMAGES) {
      throw refused(
        'TOO_MANY_IMAGES',
        `At most ${MAX_ITEM_IMAGES} photos per listing`,
      );
    }
    assertRealImage(file);

    const processed = await this.imageProcessor.upload(
      file,
      'product',
      sellerId,
    );
    const images = [...item.images, processed.key];
    await this.saveImages(itemType, itemId, images);
    return { images, isActive: item.isActive };
  }

  /**
   * Takes a photo off the item and deletes the file once nothing lists it. A
   * store product left without photos is hidden, since the web requires one.
   */
  @Post('remove')
  async removeImage(
    @Body('itemType') rawType: unknown,
    @Body('itemId') rawId: string,
    @Body('key') key: unknown,
    @Req() req: Request,
  ) {
    const itemType = parseItemType(rawType);
    const itemId = parseNumericId(rawId, 'itemId');
    const sellerId = await this.catalogSeller(req);
    const item = await this.loadItem(itemType, itemId, sellerId);
    if (typeof key !== 'string' || !item.images.includes(key)) {
      throw refused('IMAGE_NOT_LISTED', 'That photo is not on this listing');
    }

    const images = item.images.filter((k) => k !== key);
    const hide = itemType === 'storeProduct' && images.length === 0;
    await this.saveImages(itemType, itemId, images, hide);
    await this.releaseQuietly(key, sellerId);
    return { images, isActive: hide ? false : item.isActive };
  }

  /** Moves a photo to the front, where the listing cards show it. */
  @Post('cover')
  async setCover(
    @Body('itemType') rawType: unknown,
    @Body('itemId') rawId: string,
    @Body('key') key: unknown,
    @Req() req: Request,
  ) {
    const itemType = parseItemType(rawType);
    const itemId = parseNumericId(rawId, 'itemId');
    const sellerId = await this.catalogSeller(req);
    const item = await this.loadItem(itemType, itemId, sellerId);
    if (typeof key !== 'string' || !item.images.includes(key)) {
      throw refused('IMAGE_NOT_LISTED', 'That photo is not on this listing');
    }

    const images = [key, ...item.images.filter((k) => k !== key)];
    await this.saveImages(itemType, itemId, images);
    return { images, isActive: item.isActive };
  }

  /**
   * The business the admin manages the catalog of. Read per request, so a
   * turned-off account, a revoked permission or a lapsed plan stops at once.
   */
  private async catalogSeller(req: Request): Promise<string> {
    const adminId = (req as Request & { admin?: { adminId: string } }).admin
      ?.adminId;
    const admin = adminId
      ? await this.prisma.admin.findUnique({
          where: { id: adminId },
          select: {
            id: true,
            adminType: true,
            role: true,
            permissions: true,
            isActive: true,
            sellerId: true,
          },
        })
      : null;
    const managesCatalog =
      admin?.role === 'BUSINESS_OWNER' ||
      (admin?.permissions ?? []).includes('MANAGE_BUSINESS_PRODUCTS');
    if (
      !admin?.isActive ||
      admin.adminType !== 'BUSINESS' ||
      !admin.sellerId ||
      !managesCatalog ||
      (await businessPanelRefusal(this.prisma, admin))
    ) {
      throw refused(
        'PANEL_FORBIDDEN',
        "Only the business's catalog managers can change its photos",
      );
    }
    return admin.sellerId;
  }

  /**
   * The business's own row. A missing row and another business's give the
   * same answer, so this can't be used to find which ids exist.
   */
  private async loadItem(
    itemType: ItemType,
    id: number,
    sellerId: string,
  ): Promise<Item> {
    const select = { sellerId: true, images: true, isActive: true };
    const row =
      itemType === 'storeProduct'
        ? await this.prisma.storeProduct
            .findUnique({
              where: { id },
              select: { ...select, deletedAt: true },
            })
            .then((r) => (r && !r.deletedAt ? r : null))
        : await this.prisma.service.findUnique({ where: { id }, select });
    if (!row || row.sellerId !== sellerId) {
      throw refused('ITEM_NOT_FOUND', 'Listing not found in this business');
    }
    return { images: row.images ?? [], isActive: row.isActive };
  }

  private async saveImages(
    itemType: ItemType,
    id: number,
    images: string[],
    hide = false,
  ): Promise<void> {
    const data = { images, ...(hide && { isActive: false }) };
    if (itemType === 'storeProduct') {
      await this.prisma.storeProduct.update({ where: { id }, data });
    } else {
      await this.prisma.service.update({ where: { id }, data });
    }
  }

  /**
   * Deletes a photo the business no longer lists anywhere. Only files in its
   * own folder, so a URL pasted in a spreadsheet, or another business's key,
   * is never touched.
   */
  private async releaseQuietly(key: string, sellerId: string): Promise<void> {
    const prefix = `product/${sellerId}/`;
    if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) {
      return;
    }
    try {
      const where = { images: { has: key } };
      const counts = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.storeProduct.count({ where }),
        this.prisma.service.count({ where }),
      ]);
      if (counts.some((count) => count > 0)) return;
      await this.imageProcessor.delete(key);
    } catch (error) {
      this.logger.warn(`Failed to release ${key}: ${String(error)}`);
    }
  }
}
