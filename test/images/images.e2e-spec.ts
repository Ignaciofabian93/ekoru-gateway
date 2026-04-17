/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as fs from 'fs';
import * as path from 'path';

interface ImageUploadBody {
  success: boolean;
  imagePath: string;
  imageUrl: string;
  message?: string;
}

interface ImageErrorBody {
  message: string;
  error?: string;
  statusCode?: number;
}

describe('ImagesController (e2e)', () => {
  let app: INestApplication<App>;
  const testImagePath = path.join(__dirname, 'test-image.jpg');
  const uploadedFiles: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Create a test image file
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(testImagePath, testImageBuffer);
  });

  afterAll(async () => {
    // Cleanup test image
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }

    // Cleanup uploaded files
    uploadedFiles.forEach((filePath) => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.log(`Failed to delete ${filePath}:`, error);
      }
    });

    await app.close();
  });

  describe('/api/images/upload/department (POST)', () => {
    it('should upload department image successfully', () => {
      return request(app.getHttpServer())
        .post('/api/images/upload/department')
        .attach('image', testImagePath)
        .expect(201)
        .expect((res) => {
          const body = res.body as ImageUploadBody;
          expect(body).toHaveProperty('success', true);
          expect(body).toHaveProperty('imagePath');
          expect(body).toHaveProperty('imageUrl');
          expect(body.imagePath).toContain('/images/departments/');
          expect(body.imagePath).toContain('department-');

          // Track uploaded file for cleanup
          if (body.imagePath) {
            const config = {
              basePath: process.env.DEV_IMAGES_PATH || '/public/images',
            };
            uploadedFiles.push(
              path.join(
                config.basePath,
                body.imagePath.replace('/images/', ''),
              ),
            );
          }
        });
    });

    it('should return 400 when no file is uploaded', () => {
      return request(app.getHttpServer())
        .post('/api/images/upload/department')
        .expect(400)
        .expect((res) => {
          expect((res.body as ImageErrorBody).message).toBe('No file uploaded');
        });
    });

    it('should return 400 for non-image file', () => {
      const txtFilePath = path.join(__dirname, 'test.txt');
      fs.writeFileSync(txtFilePath, 'test content');

      return request(app.getHttpServer())
        .post('/api/images/upload/department')
        .attach('image', txtFilePath)
        .expect(400)
        .then(() => {
          fs.unlinkSync(txtFilePath);
        });
    });

    it('should reject files larger than 5MB', () => {
      // Create a large file (6MB)
      const largeFilePath = path.join(__dirname, 'large-image.jpg');
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
      fs.writeFileSync(largeFilePath, largeBuffer);

      return request(app.getHttpServer())
        .post('/api/images/upload/department')
        .attach('image', largeFilePath)
        .expect(413)
        .then(() => {
          fs.unlinkSync(largeFilePath);
        });
    });
  });

  describe('/api/images/upload/product (POST)', () => {
    it('should upload product image successfully', () => {
      return request(app.getHttpServer())
        .post('/api/images/upload/product')
        .attach('image', testImagePath)
        .expect(201)
        .expect((res) => {
          const body = res.body as ImageUploadBody;
          expect(body).toHaveProperty('success', true);
          expect(body).toHaveProperty('imagePath');
          expect(body).toHaveProperty('imageUrl');
          expect(body.imagePath).toContain('/images/products/');
          expect(body.imagePath).toContain('product-');

          // Track uploaded file for cleanup
          if (body.imagePath) {
            const config = {
              basePath: process.env.DEV_IMAGES_PATH || '/public/images',
            };
            uploadedFiles.push(
              path.join(
                config.basePath,
                body.imagePath.replace('/images/', ''),
              ),
            );
          }
        });
    });

    it('should return 400 when no file is uploaded', () => {
      return request(app.getHttpServer())
        .post('/api/images/upload/product')
        .expect(400)
        .expect((res) => {
          expect(res.body as ImageErrorBody).toHaveProperty(
            'message',
            'No file uploaded',
          );
        });
    });
  });

  describe('/api/images/upload/user (POST)', () => {
    it('should upload user image successfully', () => {
      return request(app.getHttpServer())
        .post('/api/images/upload/user')
        .attach('image', testImagePath)
        .expect(201)
        .expect((res) => {
          const body = res.body as ImageUploadBody;
          expect(body).toHaveProperty('success', true);
          expect(body).toHaveProperty('imagePath');
          expect(body).toHaveProperty('imageUrl');
          expect(body.imagePath).toContain('/images/users/');
          expect(body.imagePath).toContain('user-');

          // Track uploaded file for cleanup
          if (body.imagePath) {
            const config = {
              basePath: process.env.DEV_IMAGES_PATH || '/public/images',
            };
            uploadedFiles.push(
              path.join(
                config.basePath,
                body.imagePath.replace('/images/', ''),
              ),
            );
          }
        });
    });

    it('should return 400 when no file is uploaded', () => {
      return request(app.getHttpServer())
        .post('/api/images/upload/user')
        .expect(400);
    });
  });

  describe('/api/images/:category/:filename (GET)', () => {
    let uploadedImagePath: string;
    let uploadedFilename: string;

    beforeAll(async () => {
      // Upload an image to test retrieval
      const response = await request(app.getHttpServer())
        .post('/api/images/upload/product')
        .attach('image', testImagePath);

      uploadedImagePath = (response.body as ImageUploadBody).imagePath;
      const pathParts = uploadedImagePath.split('/');
      uploadedFilename = pathParts[pathParts.length - 1];
    });

    it('should retrieve uploaded image successfully', () => {
      return request(app.getHttpServer())
        .get('/api/images/products/' + uploadedFilename)
        .expect(200)
        .expect('Content-Type', /image/);
    });

    it('should return 404 for non-existent image', () => {
      return request(app.getHttpServer())
        .get('/api/images/products/nonexistent-image.jpg')
        .expect(404)
        .expect((res) => {
          expect((res.body as ImageErrorBody).error).toBe('Image not found');
        });
    });

    it('should return 404 for invalid category', () => {
      return request(app.getHttpServer())
        .get('/api/images/invalid-category/test.jpg')
        .expect(404);
    });
  });

  describe('Image upload validation', () => {
    it('should accept valid image formats (jpg)', () => {
      return request(app.getHttpServer())
        .post('/api/images/upload/product')
        .attach('image', testImagePath)
        .expect(201);
    });

    it('should generate unique filenames for multiple uploads', async () => {
      const response1 = await request(app.getHttpServer())
        .post('/api/images/upload/product')
        .attach('image', testImagePath);

      const response2 = await request(app.getHttpServer())
        .post('/api/images/upload/product')
        .attach('image', testImagePath);

      const body1 = response1.body as ImageUploadBody;
      const body2 = response2.body as ImageUploadBody;
      expect(body1.imagePath).not.toBe(body2.imagePath);

      // Track uploaded files for cleanup
      const config = {
        basePath: process.env.DEV_IMAGES_PATH || '/public/images',
      };
      uploadedFiles.push(
        path.join(config.basePath, body1.imagePath.replace('/images/', '')),
        path.join(config.basePath, body2.imagePath.replace('/images/', '')),
      );
    });
  });
});
