import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class ImagesService {
  constructor(private readonly configService: ConfigService) {}

  getImagesConfig() {
    const environment = this.configService.get<string>(
      'ENVIRONMENT',
      'development',
    );

    if (environment === 'development') {
      const externalUrl = this.configService.get<string>(
        'GATEWAY_EXTERNAL_URL',
        'http://localhost:4000',
      );
      return {
        basePath: this.configService.get<string>(
          'DEV_IMAGES_PATH',
          '/public/images',
        ),
        baseUrl: `${externalUrl}/images`,
      };
    } else if (environment === 'staging') {
      return {
        basePath: this.configService.get<string>('IMAGES_PATH', '/app/images'),
        baseUrl: this.configService.get<string>(
          'IMAGES_BASE_URL',
          'https://api.staging.ekoru.cl/images',
        ),
      };
    } else {
      return {
        basePath: this.configService.get<string>('IMAGES_PATH', '/app/images'),
        baseUrl: this.configService.get<string>(
          'IMAGES_BASE_URL',
          'https://api.ekoru.cl/images',
        ),
      };
    }
  }

  async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  generateUniqueFilename(originalName: string, prefix: string = ''): string {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(originalName);
    return prefix ? prefix + '-' + uniqueSuffix + ext : uniqueSuffix + ext;
  }

  async saveFile(
    buffer: Buffer,
    subPath: string,
    filename: string,
  ): Promise<string> {
    const config = this.getImagesConfig();
    const uploadDir = path.join(config.basePath, subPath);
    await this.ensureDirectoryExists(uploadDir);
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, buffer);
    return '/images/' + subPath + '/' + filename;
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getFullUrl(imagePath: string): string {
    const config = this.getImagesConfig();
    return config.baseUrl + imagePath.replace('/images', '');
  }
}
