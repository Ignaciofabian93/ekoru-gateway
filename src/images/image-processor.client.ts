import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The image processor's answers that mean "this image", not "our side". */
const IMAGE_REFUSED = new Set([400, 413, 422]);

const SAVE_FAILED =
  'The image could not be saved. Please try again in a few minutes.';

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
      if (IMAGE_REFUSED.has(res.status)) {
        throw new BadRequestException(
          'The image could not be processed. Try a JPG, PNG or WebP image under 10 MB.',
        );
      }
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
