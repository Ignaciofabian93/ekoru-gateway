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
 * Why an image was refused. The message stays in English for logs; the apps
 * read `code` and tell the person what to change, in their language.
 * - IMAGE_FORMAT: a format the processor cannot decode (HEIC, AVIF, PDF…).
 * - IMAGE_TOO_HEAVY: over the byte limit.
 * - IMAGE_TOO_LARGE: over the processor's pixel limits.
 * - IMAGE_UNREADABLE: a supported format, but damaged or truncated.
 */
export type ImageRefusal =
  | 'IMAGE_FORMAT'
  | 'IMAGE_TOO_HEAVY'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_UNREADABLE';

export function imageRefused(
  code: ImageRefusal,
  message: string,
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code,
    message,
  });
}

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
    cb(imageRefused('IMAGE_FORMAT', 'Only image files are allowed'), false);
  }
};

/**
 * HEIC (iPhone and some Android cameras) and AVIF share the ISO-BMFF `ftyp`
 * box at offset 4. The processor decodes neither (no HEIC decoder, and AVIF
 * needs the `avif-native` feature), so they are refused here by name rather
 * than failing in the processor.
 */
const isHeicOrAvif = (b: Buffer) =>
  b.subarray(4, 8).toString('ascii') === 'ftyp';

/** Byte signatures for the formats the image processor decodes. */
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
];

/**
 * Verifies the bytes really are an image. `Content-Type` is supplied by the
 * client and is trivially spoofed, so it is never the basis for this decision.
 */
export function assertRealImage(file: Express.Multer.File): void {
  if (!file?.buffer || file.buffer.length < 12) {
    throw imageRefused(
      'IMAGE_UNREADABLE',
      'Uploaded file is empty or truncated',
    );
  }
  if (isHeicOrAvif(file.buffer)) {
    throw imageRefused(
      'IMAGE_FORMAT',
      'HEIC and AVIF images are not supported; use JPEG, PNG or WebP',
    );
  }
  if (!SIGNATURES.some((sig) => sig.test(file.buffer))) {
    throw imageRefused(
      'IMAGE_FORMAT',
      'File content is not a recognised image (JPEG, PNG, GIF or WebP)',
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
