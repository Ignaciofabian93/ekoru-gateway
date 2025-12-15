import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { hash } from 'bcrypt';

describe('AuthController (e2e)', () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;

  const testSeller = {
    id: 'test-seller-id',
    email: 'test@example.com',
    password: 'Test123!',
    name: 'Test Seller',
    phone: '123456789',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = moduleFixture.get<PrismaService>(PrismaService);

    // Create test seller with hashed password
    const hashedPassword = await hash(testSeller.password, 10);
    await prismaService.seller.upsert({
      where: { email: testSeller.email },
      create: {
        id: testSeller.id,
        email: testSeller.email,
        password: hashedPassword,
        phone: testSeller.phone,
        sellerType: 'PERSON',
      },
      update: {
        password: hashedPassword,
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data
    await prismaService.seller.deleteMany({
      where: { email: testSeller.email },
    });
    await prismaService.$disconnect();
    await app.close();
  });

  describe('/session/auth (POST)', () => {
    it('should login successfully with valid credentials', () => {
      return request(app.getHttpServer())
        .post('/session/auth')
        .send({
          email: testSeller.email,
          password: testSeller.password,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('token');
          expect(res.body).toHaveProperty(
            'message',
            'Inicio de sesión exitoso',
          );
          expect(res.headers['set-cookie']).toBeDefined();

          // Check that cookies are set
          const cookies = res.headers['set-cookie'] as unknown as string[];
          expect(cookies.some((cookie) => cookie.startsWith('token='))).toBe(
            true,
          );
          expect(
            cookies.some((cookie) => cookie.startsWith('refreshToken=')),
          ).toBe(true);
        });
    });

    it('should login with case-insensitive email', () => {
      return request(app.getHttpServer())
        .post('/session/auth')
        .send({
          email: testSeller.email.toUpperCase(),
          password: testSeller.password,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('token');
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should return 400 for non-existent user', () => {
      return request(app.getHttpServer())
        .post('/session/auth')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty(
            'message',
            'No se encontró al usuario',
          );
        });
    });

    it('should return 400 for invalid password', () => {
      return request(app.getHttpServer())
        .post('/session/auth')
        .send({
          email: testSeller.email,
          password: 'wrongpassword',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message', 'Credenciales inválidas');
        });
    });

    it('should return 400 for missing email', () => {
      return request(app.getHttpServer())
        .post('/session/auth')
        .send({
          password: testSeller.password,
        })
        .expect(400);
    });

    it('should return 400 for missing password', () => {
      return request(app.getHttpServer())
        .post('/session/auth')
        .send({
          email: testSeller.email,
        })
        .expect(400);
    });
  });

  describe('/session/refresh (POST)', () => {
    let validRefreshToken: string;

    beforeAll(async () => {
      // Get a valid refresh token by logging in
      const response = await request(app.getHttpServer())
        .post('/session/auth')
        .send({
          email: testSeller.email,
          password: testSeller.password,
        });

      // Extract refresh token from cookies
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const refreshTokenCookie = cookies.find((cookie) =>
        cookie.startsWith('refreshToken='),
      );
      validRefreshToken = refreshTokenCookie?.split(';')[0].split('=')[1] || '';
    });

    it('should refresh token successfully with valid refresh token', () => {
      return request(app.getHttpServer())
        .post('/session/refresh')
        .send({
          refreshToken: validRefreshToken,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('token');
          expect(res.body).toHaveProperty('success', true);

          // Check that new token cookie is set
          const cookies = res.headers['set-cookie'] as unknown as string[];
          expect(cookies.some((cookie) => cookie.startsWith('token='))).toBe(
            true,
          );
        });
    });

    it('should return 401 for missing refresh token', () => {
      return request(app.getHttpServer())
        .post('/session/refresh')
        .send({})
        .expect(401)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          expect(res.body.message).toBe(
            'No se pudo generar un nuevo token de acceso',
          );
        });
    });

    it('should return 401 for invalid refresh token', () => {
      return request(app.getHttpServer())
        .post('/session/refresh')
        .send({
          refreshToken: 'invalid.token.here',
        })
        .expect(401)
        .expect((res) => {
          expect(res.body).toHaveProperty(
            'message',
            'Token de acceso inválido',
          );
        });
    });

    it('should return 401 for expired refresh token', () => {
      const expiredToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZWxsZXJJZCI6InRlc3QiLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTUxNjIzOTAyMn0.invalid';

      return request(app.getHttpServer())
        .post('/session/refresh')
        .send({
          refreshToken: expiredToken,
        })
        .expect(401);
    });
  });
});
