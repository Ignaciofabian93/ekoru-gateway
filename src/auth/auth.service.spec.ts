import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockSeller = {
    id: 'seller-123',
    email: 'test@example.com',
    password: '$2b$10$hashedpassword',
    sellerType: 'PERSON' as const,
    isActive: true,
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    address: null,
    cityId: null,
    countryId: null,
    countyId: null,
    regionId: null,
    phone: '123456789',
    website: null,
    preferredContactMethod: null,
    socialMediaLinks: null,
    points: 0,
    sellerLevelId: null,
  };

  const mockResponse = () => {
    const res: Partial<Response> = {
      cookie: jest.fn().mockReturnThis(),
    };
    return res as Response;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            seller: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const config: Record<string, string> = {
                JWT_REFRESH_SECRET: 'test-refresh-secret',
                ENVIRONMENT: 'development',
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const res = mockResponse();
      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jest
        .spyOn(jwtService, 'sign')
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      const result = await service.login(
        'test@example.com',
        'password123',
        res,
      );

      expect(result).toEqual({
        token: 'access-token',
        message: 'Inicio de sesión exitoso',
      });
      expect(prismaService.seller.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      const cookieSpy = res.cookie as jest.Mock;
      expect(cookieSpy).toHaveBeenCalledTimes(2);
      expect(cookieSpy).toHaveBeenCalledWith(
        'token',
        'access-token',
        expect.any(Object),
      );
      expect(cookieSpy).toHaveBeenCalledWith(
        'refreshToken',
        'refresh-token',
        expect.any(Object),
      );
    });

    it('should convert email to lowercase', async () => {
      const res = mockResponse();
      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      await service.login('TEST@EXAMPLE.COM', 'password123', res);

      expect(prismaService.seller.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should throw BadRequestException if user not found', async () => {
      const res = mockResponse();
      jest.spyOn(prismaService.seller, 'findUnique').mockResolvedValue(null);

      await expect(
        service.login('nonexistent@example.com', 'password123', res),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.login('nonexistent@example.com', 'password123', res),
      ).rejects.toThrow('No se encontró al usuario');
    });

    it('should throw BadRequestException if password is invalid', async () => {
      const res = mockResponse();
      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('test@example.com', 'wrongpassword', res),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.login('test@example.com', 'wrongpassword', res),
      ).rejects.toThrow('Credenciales inválidas');
    });

    it('should set secure cookies in production environment', async () => {
      const res = mockResponse();
      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENVIRONMENT') return 'production';
        if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
        return undefined;
      });

      await service.login('test@example.com', 'password123', res);

      const cookieSpy = res.cookie as jest.Mock;
      expect(cookieSpy).toHaveBeenCalledWith(
        'token',
        'token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          domain: '.ekoru.cl',
        }),
      );
    });

    it('should set non-secure cookies in development environment', async () => {
      const res = mockResponse();
      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      await service.login('test@example.com', 'password123', res);

      const cookieSpy = res.cookie as jest.Mock;
      expect(cookieSpy).toHaveBeenCalledWith(
        'token',
        'token',
        expect.objectContaining({
          httpOnly: false,
          secure: false,
          sameSite: 'lax',
          domain: undefined,
        }),
      );
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully with valid refresh token', () => {
      const res = mockResponse();
      jest
        .spyOn(jwtService, 'verify')
        .mockReturnValue({ sellerId: 'seller-123' });
      jest.spyOn(jwtService, 'sign').mockReturnValue('new-access-token');

      const result = service.refreshToken('valid-refresh-token', res);

      expect(result).toEqual({
        token: 'new-access-token',
        success: true,
      });
      expect(jwtService.verify).toHaveBeenCalledWith('valid-refresh-token', {
        secret: 'test-refresh-secret',
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sellerId: 'seller-123' },
        { expiresIn: '15m' },
      );
      const cookieSpy = res.cookie as jest.Mock;
      expect(cookieSpy).toHaveBeenCalledWith(
        'token',
        'new-access-token',
        expect.any(Object),
      );
    });

    it('should throw UnauthorizedException if refresh token is missing', () => {
      const res = mockResponse();

      expect(() => service.refreshToken('', res)).toThrow(
        UnauthorizedException,
      );
      expect(() => service.refreshToken('', res)).toThrow(
        'No se pudo generar un nuevo token de acceso',
      );
    });

    it('should throw UnauthorizedException if refresh token is invalid', () => {
      const res = mockResponse();
      jest.spyOn(jwtService, 'verify').mockImplementation(() => {
        throw new Error('Invalid token');
      });

      expect(() => service.refreshToken('invalid-token', res)).toThrow(
        UnauthorizedException,
      );
      expect(() => service.refreshToken('invalid-token', res)).toThrow(
        'Token de acceso inválido',
      );
    });

    it('should set secure cookies in QA environment', () => {
      const res = mockResponse();
      jest
        .spyOn(jwtService, 'verify')
        .mockReturnValue({ sellerId: 'seller-123' });
      jest.spyOn(jwtService, 'sign').mockReturnValue('new-token');
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENVIRONMENT') return 'qa';
        if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
        return undefined;
      });

      service.refreshToken('valid-token', res);

      const cookieSpy = res.cookie as jest.Mock;
      expect(cookieSpy).toHaveBeenCalledWith(
        'token',
        'new-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          domain: '.ekoru.cl',
        }),
      );
    });
  });

  describe('decodeToken', () => {
    it('should decode valid JWT token', () => {
      jest
        .spyOn(jwtService, 'verify')
        .mockReturnValue({ sellerId: 'seller-123' });

      const result = service.decodeToken('valid-token');

      expect(result).toEqual({ sellerId: 'seller-123' });
      expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
    });

    it('should try refresh secret if regular secret fails', () => {
      const verifySpy = jest
        .spyOn(jwtService, 'verify')
        .mockImplementationOnce(() => {
          throw new Error('Invalid token');
        })
        .mockReturnValueOnce({ sellerId: 'seller-123' });

      const result = service.decodeToken('refresh-token');

      expect(result).toEqual({ sellerId: 'seller-123' });
      expect(verifySpy).toHaveBeenCalledTimes(2);
      expect(verifySpy).toHaveBeenLastCalledWith('refresh-token', {
        secret: 'test-refresh-secret',
      });
    });

    it('should return null if token is empty', () => {
      const result = service.decodeToken('');

      expect(result).toBeNull();
    });

    it('should return null if both secrets fail', () => {
      const verifySpy = jest
        .spyOn(jwtService, 'verify')
        .mockImplementation(() => {
          throw new Error('Invalid token');
        });
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = service.decodeToken('invalid-token');

      expect(result).toBeNull();
      expect(verifySpy).toHaveBeenCalledTimes(2);
    });

    it('should return null for null token', () => {
      const result = service.decodeToken(null as unknown as string);

      expect(result).toBeNull();
    });
  });
});
