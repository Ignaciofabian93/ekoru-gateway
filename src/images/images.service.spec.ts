import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ImagesService } from './images.service';
import * as fs from 'fs/promises';

// Mock fs/promises module
jest.mock('fs/promises');

describe('ImagesService', () => {
  let service: ImagesService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        ENVIRONMENT: 'development',
        DEV_IMAGES_PATH: '/public/images',
        IMAGES_PATH: '/app/images',
        IMAGES_BASE_URL: 'https://qa.gateway.ekoru.cl/images',
      };
      return config[key] || defaultValue || '';
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImagesService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ImagesService>(ImagesService);
  });
  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getImagesConfig', () => {
    it('should return development config when environment is development', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) => {
          if (key === 'ENVIRONMENT') return 'development';
          if (key === 'DEV_IMAGES_PATH') return '/public/images';
          return defaultValue || '';
        },
      );

      const config = service.getImagesConfig();

      expect(config).toEqual({
        basePath: '/public/images',
        baseUrl: 'http://localhost:4000/images',
      });
    });

    it('should return QA config when environment is qa', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) => {
          if (key === 'ENVIRONMENT') return 'qa';
          if (key === 'IMAGES_PATH') return '/app/images';
          if (key === 'IMAGES_BASE_URL')
            return 'https://qa.gateway.ekoru.cl/images';
          return defaultValue || '';
        },
      );

      const config = service.getImagesConfig();

      expect(config).toEqual({
        basePath: '/app/images',
        baseUrl: 'https://qa.gateway.ekoru.cl/images',
      });
    });

    it('should return staging config when environment is staging', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) => {
          if (key === 'ENVIRONMENT') return 'staging';
          if (key === 'IMAGES_PATH') return '/app/images';
          if (key === 'IMAGES_BASE_URL')
            return 'https://api.staging.ekoru.cl/images';
          return defaultValue || '';
        },
      );

      const config = service.getImagesConfig();

      expect(config).toEqual({
        basePath: '/app/images',
        baseUrl: 'https://api.staging.ekoru.cl/images',
      });
    });

    it('should return production config when environment is production', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) => {
          if (key === 'ENVIRONMENT') return 'production';
          if (key === 'IMAGES_PATH') return '/app/images';
          if (key === 'IMAGES_BASE_URL') return 'https://api.ekoru.cl/images';
          return defaultValue || '';
        },
      );

      const config = service.getImagesConfig();

      expect(config).toEqual({
        basePath: '/app/images',
        baseUrl: 'https://api.ekoru.cl/images',
      });
    });

    it('should use default values when config is missing', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) => {
          if (key === 'ENVIRONMENT') return 'development';
          return defaultValue || '';
        },
      );

      const config = service.getImagesConfig();

      expect(config).toEqual({
        basePath: '/public/images',
        baseUrl: 'http://localhost:4000/images',
      });
    });
  });

  describe('ensureDirectoryExists', () => {
    it('should not create directory if it already exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      await service.ensureDirectoryExists('/test/path');

      expect(fs.access).toHaveBeenCalledWith('/test/path');
      expect(fs.mkdir).not.toHaveBeenCalled();
    });

    it('should create directory if it does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(
        new Error('Directory not found'),
      );
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);

      await service.ensureDirectoryExists('/test/path');

      expect(fs.access).toHaveBeenCalledWith('/test/path');
      expect(fs.mkdir).toHaveBeenCalledWith('/test/path', { recursive: true });
    });

    it('should create nested directories recursively', async () => {
      (fs.access as jest.Mock).mockRejectedValue(
        new Error('Directory not found'),
      );
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);

      await service.ensureDirectoryExists('/test/nested/deep/path');

      expect(fs.mkdir).toHaveBeenCalledWith('/test/nested/deep/path', {
        recursive: true,
      });
    });
  });

  describe('generateUniqueFilename', () => {
    it('should generate unique filename with prefix', () => {
      const filename1 = service.generateUniqueFilename('test.jpg', 'product');
      const filename2 = service.generateUniqueFilename('test.jpg', 'product');

      expect(filename1).toMatch(/^product-\d+-\d+\.jpg$/);
      expect(filename2).toMatch(/^product-\d+-\d+\.jpg$/);
      expect(filename1).not.toBe(filename2);
    });

    it('should generate unique filename without prefix', () => {
      const filename1 = service.generateUniqueFilename('test.jpg');
      const filename2 = service.generateUniqueFilename('test.jpg');

      expect(filename1).toMatch(/^\d+-\d+\.jpg$/);
      expect(filename2).toMatch(/^\d+-\d+\.jpg$/);
      expect(filename1).not.toBe(filename2);
    });

    it('should preserve file extension', () => {
      const pngFilename = service.generateUniqueFilename('image.png', 'user');
      const jpgFilename = service.generateUniqueFilename('photo.jpg', 'user');
      const gifFilename = service.generateUniqueFilename(
        'animation.gif',
        'user',
      );

      expect(pngFilename).toMatch(/\.png$/);
      expect(jpgFilename).toMatch(/\.jpg$/);
      expect(gifFilename).toMatch(/\.gif$/);
    });

    it('should handle files without extension', () => {
      const filename = service.generateUniqueFilename('noextension', 'test');

      expect(filename).toMatch(/^test-\d+-\d+$/);
    });

    it('should handle multiple dots in filename', () => {
      const filename = service.generateUniqueFilename(
        'my.image.file.jpg',
        'product',
      );

      expect(filename).toMatch(/^product-\d+-\d+\.jpg$/);
    });
  });

  describe('saveFile', () => {
    it('should save file to correct path', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      const buffer = Buffer.from('test image data');

      const result = await service.saveFile(buffer, 'products', 'test-123.jpg');

      expect(fs.writeFile).toHaveBeenCalled();
      expect(result).toBe('/images/products/test-123.jpg');
    });

    it('should create directory if it does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(
        new Error('Directory not found'),
      );
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      const buffer = Buffer.from('test image data');

      await service.saveFile(buffer, 'departments', 'dept-456.jpg');

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should construct correct file path with subPath', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      const buffer = Buffer.from('test');

      const result = await service.saveFile(buffer, 'users', 'user-789.png');

      expect(result).toBe('/images/users/user-789.png');
    });

    it('should handle nested subPaths', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      const buffer = Buffer.from('test');

      const result = await service.saveFile(
        buffer,
        'products/thumbnails',
        'thumb.jpg',
      );

      expect(result).toBe('/images/products/thumbnails/thumb.jpg');
    });
  });

  describe('deleteFile', () => {
    it('should delete existing file and return true', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      const result = await service.deleteFile('/test/path/image.jpg');

      expect(fs.access).toHaveBeenCalledWith('/test/path/image.jpg');
      expect(fs.unlink).toHaveBeenCalledWith('/test/path/image.jpg');
      expect(result).toBe(true);
    });

    it('should return false if file does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));

      const result = await service.deleteFile('/test/path/nonexistent.jpg');

      expect(fs.access).toHaveBeenCalledWith('/test/path/nonexistent.jpg');
      expect(fs.unlink).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should return false if deletion fails', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.unlink as jest.Mock).mockRejectedValue(new Error('Deletion failed'));

      const result = await service.deleteFile('/test/path/image.jpg');

      expect(result).toBe(false);
    });
  });

  describe('getFullUrl', () => {
    it('should generate correct full URL in development', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) => {
          if (key === 'ENVIRONMENT') return 'development';
          if (key === 'DEV_IMAGES_PATH') return '/public/images';
          return defaultValue || '';
        },
      );

      const url = service.getFullUrl('/images/products/test.jpg');

      expect(url).toBe('http://localhost:4000/images/products/test.jpg');
    });

    it('should generate correct full URL in QA', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) => {
          if (key === 'ENVIRONMENT') return 'qa';
          if (key === 'IMAGES_BASE_URL')
            return 'https://qa.gateway.ekoru.cl/images';
          return defaultValue || '';
        },
      );

      const url = service.getFullUrl('/images/users/avatar.png');

      expect(url).toBe('https://qa.gateway.ekoru.cl/images/users/avatar.png');
    });

    it('should generate correct full URL in production', () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) => {
          if (key === 'ENVIRONMENT') return 'production';
          if (key === 'IMAGES_BASE_URL') return 'https://api.ekoru.cl/images';
          return defaultValue || '';
        },
      );

      const url = service.getFullUrl('/images/departments/dept.jpg');

      expect(url).toBe('https://api.ekoru.cl/images/departments/dept.jpg');
    });

    it('should handle paths with leading /images correctly', () => {
      const url = service.getFullUrl('/images/products/test.jpg');

      expect(url).toContain('/products/test.jpg');
      expect(url).not.toContain('/images/images/');
    });

    it('should handle paths without leading /images', () => {
      const url = service.getFullUrl('products/test.jpg');

      expect(url).toContain('products/test.jpg');
    });
  });
});
