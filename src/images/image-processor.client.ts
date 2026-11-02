import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { imageRefused, type ImageRefusal } from './upload-security';

const SAVE_FAILED =
  'The image could not be saved. Please try again in a few minutes.';

const REFUSED: Record<ImageRefusal, string> = {
  IMAGE_FORMAT:
    'This image format is not supported. Use a JPEG, PNG or WebP image.',
  IMAGE_TOO_HEAVY: 'The image is larger than 10 MB.',
  IMAGE_TOO_LARGE: 'The image is too large: at most 10,000 pixels per side.',
  IMAGE_UNREADABLE: 'The image could not be read; it may be damaged.',
};

/** How the `image` crate words a format it has no decoder for. */
const UNSUPPORTED =
  /could not be determined|not supported|does not support|not recognized/i;

/**
 * Reads the processor's answers that mean "this image", not "our side": 413
 * over its byte limit, 400 over its pixel limits ("image too large") or a
 * malformed upload, 422 a file it could not decode. Null for anything else.
 */
export function refusalOf(status: number, body: string): ImageRefusal | null {
  if (status === 413) return 'IMAGE_TOO_HEAVY';
  if (status === 400) {
    return body.includes('image too large')
      ? 'IMAGE_TOO_LARGE'
      : 'IMAGE_UNREADABLE';
  }
  if (status === 422) {
    return UNSUPPORTED.test(body) ? 'IMAGE_FORMAT' : 'IMAGE_UNREADABLE';
  }
  return null;
}

export type ImageEntity =
  | 'user_avatar'
  | 'user_cover'
  | 'product'
  | 'service'
  | 'community'
  | 'asset';

export interface ProcessedImage {
  key: string;
  url: string;
  original_size: number;
  processed_size: number;
  width: number;
  height: number;
}

@Injectable()
export class ImageProcessorClient {
  private readonly logger = new Logger(ImageProcessorClient.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('IMAGE_PROCESSOR_URL');
    this.token = config.getOrThrow<string>('IMAGE_PROCESSOR_TOKEN');
  }

  async upload(
    file: Express.Multer.File,
    entity: ImageEntity,
    entityId: string,
  ): Promise<ProcessedImage> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    form.append('entity', entity);
    form.append('entity_id', entityId);

    // The log names the upload; the app only learns whether to try another
    // image (the image was refused) or to try again later (our side failed).
    const upload = `${entity} ${entityId}, ${file.mimetype} ${file.size} bytes`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/process`, {
        method: 'POST',
        headers: { 'X-Internal-Token': this.token },
        body: form,
      });
    } catch (error) {
      this.logger.error(
        `image-processor /process unreachable for ${upload}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(SAVE_FAILED);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(
        `image-processor /process ${res.status} for ${upload}: ${text || '(no body)'}`,
      );
      const refusal = refusalOf(res.status, text);
      if (refusal) throw imageRefused(refusal, REFUSED[refusal]);
      throw new InternalServerErrorException(SAVE_FAILED);
    }

    return (await res.json()) as ProcessedImage;
  }

  async delete(key: string): Promise<void> {
    if (!key) return;
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${this.baseUrl}/objects/${encoded}`, {
      method: 'DELETE',
      headers: { 'X-Internal-Token': this.token },
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `image-processor delete ${res.status} for key=${key}: ${text || '(no body)'}`,
      );
    }
  }
}
