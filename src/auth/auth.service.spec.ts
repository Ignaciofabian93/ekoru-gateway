import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenRepository } from './token.repository';
import { I18nService } from '../common/i18n';
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
        {
          provide: I18nService,
          useValue: {
            translate: jest.fn((key: string) => {
              const messages: Record<string, string> = {
                'auth.user_not_found': 'No se encontró al usuario',
                'auth.invalid_credentials': 'Credenciales inválidas',
                'auth.login_success': 'Inicio de sesión exitoso',
                'auth.token_refresh_failed':
                  'No se pudo generar un nuevo token de acceso',
                'auth.token_invalid': 'Token de acceso inválido',
                'auth.token_revoked':
                  'El token de actualización ha sido revocado',
              };
              return messages[key] ?? key;
            }),
          },
        },
        {
          provide: TokenRepository,
          useValue: {
            save: jest.fn().mockResolvedValue(undefined),
            isRevoked: jest.fn().mockResolvedValue(false),
            revoke: jest.fn().mockResolvedValue(undefined),
            revokeAllForUser: jest.fn().mockResolvedValue(undefined),
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

      expect(result).toEqual(
        expect.objectContaining({
          token: 'access-token',
          message: 'Inicio de sesión exitoso',
        }),
      );
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
          sameSite: 'strict',
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
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          domain: undefined,
        }),
      );
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully with valid refresh token', async () => {
      const res = mockResponse();
      jest
        .spyOn(jwtService, 'verify')
        .mockReturnValue({ sellerId: 'seller-123' });
      jest.spyOn(jwtService, 'sign').mockReturnValue('new-access-token');

      const result = await service.refreshToken('valid-refresh-token', res);

      expect(result).toEqual(
        expect.objectContaining({
          token: 'new-access-token',
          success: true,
        }),
      );
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

    it('should throw UnauthorizedException if refresh token is missing', async () => {
      const res = mockResponse();

      await expect(service.refreshToken('', res)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshToken('', res)).rejects.toThrow(
        'No se pudo generar un nuevo token de acceso',
      );
    });

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      const res = mockResponse();
      jest.spyOn(jwtService, 'verify').mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.refreshToken('invalid-token', res)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshToken('invalid-token', res)).rejects.toThrow(
        'Token de acceso inválido',
      );
    });

    it('should set secure cookies in QA environment', async () => {
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

      await service.refreshToken('valid-token', res);

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
