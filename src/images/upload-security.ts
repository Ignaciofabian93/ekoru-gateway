import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Shared hardening for the upload routes.
 *
 * These endpoints write to object storage and overwrite rows that belong to a
 * seller, so two things have to hold on every one of them: the caller is
 * authenticated (the `JwtAuthGuard` / `JwtAdminGuard` on the route), and the
 * row they name is actually theirs (`assertOwns*` below). Authentication alone
 * is not enough — without the ownership check any signed-in seller can target
 * another seller's product id.
 */

/**
 * Multer's `fileFilter` runs before the body is buffered, so `file.buffer` is
 * not available there and only the declared mimetype can be seen — which the
 * client chooses. Keep this as a cheap first pass and rely on
 * `assertRealImage` in the handler for the actual decision.
 */
export const declaredImageFilter = (
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new BadRequestException('Only image files are allowed'), false);
  }
};

/** Byte signatures for the formats the image processor accepts. */
const SIGNATURES: { name: string; test: (b: Buffer) => boolean }[] = [
  {
    name: 'jpeg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    name: 'png',
    test: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    name: 'gif',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8',
  },
  {
    name: 'webp',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    // AVIF / HEIC share the ISO-BMFF `ftyp` box at offset 4.
    name: 'avif/heic',
    test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
];

/**
 * Verifies the bytes really are an image. `Content-Type` is supplied by the
 * client and is trivially spoofed, so it is never the basis for this decision.
 */
export function assertRealImage(file: Express.Multer.File): void {
  if (!file?.buffer || file.buffer.length < 12) {
    throw new BadRequestException('Uploaded file is empty or truncated');
  }
  if (!SIGNATURES.some((sig) => sig.test(file.buffer))) {
    throw new BadRequestException(
      'File content is not a recognised image (JPEG, PNG, GIF, WebP, AVIF/HEIC)',
    );
  }
}

/** The seller id put on the request by `JwtAuthGuard`. */
export function sellerIdOf(req: Request): string {
  const sellerId = (req as Request & { user?: { sellerId?: string } }).user
    ?.sellerId;
  if (!sellerId) throw new ForbiddenException('Authentication required');
  return sellerId;
}

/** Parses an id that arrived as a form field, rejecting anything non-numeric. */
export function parseNumericId(raw: string, field: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return id;
}

export async function assertOwnsProduct(
  prisma: PrismaService,
  productId: number,
  sellerId: string,
): Promise<void> {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: { sellerId: true },
  });
  assertOwned(row?.sellerId, sellerId, 'Product');
}

export async function assertOwnsStoreProduct(
  prisma: PrismaService,
  storeProductId: number,
  sellerId: string,
): Promise<void> {
  const row = await prisma.storeProduct.findUnique({
    where: { id: storeProductId },
    select: { sellerId: true },
  });
  assertOwned(row?.sellerId, sellerId, 'Store product');
}

export async function assertOwnsService(
  prisma: PrismaService,
  serviceId: number,
  sellerId: string,
): Promise<void> {
  const row = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { sellerId: true },
  });
  assertOwned(row?.sellerId, sellerId, 'Service');
}

/**
 * A missing row and someone else's row give the same answer on purpose —
 * otherwise this doubles as an oracle for which product ids exist.
 */
function assertOwned(
  ownerId: string | undefined,
  sellerId: string,
  label: string,
): void {
  if (!ownerId || ownerId !== sellerId) {
    throw new ForbiddenException(`${label} not found or not yours`);
  }
}
