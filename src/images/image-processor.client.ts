import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

    const res = await fetch(`${this.baseUrl}/process`, {
      method: 'POST',
      headers: { 'X-Internal-Token': this.token },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(
        `image-processor /process ${res.status}: ${text || '(no body)'}`,
      );
      throw new InternalServerErrorException(
        `image-processor returned ${res.status}`,
      );
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
