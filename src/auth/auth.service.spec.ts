import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenRepository } from './token.repository';
import { I18nService } from '../common/i18n';
import { NotificationsClient } from '../mail/notifications.client';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let notificationsClient: { sendLoginAlert: jest.Mock };

  const mockSeller = {
    id: 'seller-123',
    email: 'test@example.com',
    password: '$2b$10$hashedpassword',
    sellerType: 'PERSON' as const,
    isActive: true,
    isVerified: true,
    loginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    address: null,
    cityId: null,
    countryId: null,
    countyId: null,
    regionId: null,
    contentLanguage: null,
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
    notificationsClient = {
      sendLoginAlert: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            seller: {
              findUnique: jest.fn(),
              // Login now writes to the seller row: it clears the brute-force
              // counter and stamps lastLoginAt on success, and increments the
              // counter on failure.
              update: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: NotificationsClient,
          useValue: notificationsClient,
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

    it('should request a login alert with the device details', async () => {
      const res = mockResponse();
      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');

      await service.login('test@example.com', 'password123', res, 'es', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/138.0.0.0',
        ipAddress: '190.1.2.3',
      });

      expect(notificationsClient.sendLoginAlert).toHaveBeenCalledWith(
        'seller-123',
        expect.objectContaining({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/138.0.0.0',
          ipAddress: '190.1.2.3',
          occurredAt: expect.any(Date),
        }),
      );
    });

    it('should still resolve the login when the alert cannot be sent', async () => {
      const res = mockResponse();
      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jest.spyOn(jwtService, 'sign').mockReturnValue('token');
      notificationsClient.sendLoginAlert.mockRejectedValue(
        new Error('users unreachable'),
      );

      await expect(
        service.login('test@example.com', 'password123', res),
      ).resolves.toEqual(
        expect.objectContaining({ message: 'Inicio de sesión exitoso' }),
      );
    });

    it('should not send a login alert when credentials are rejected', async () => {
      const res = mockResponse();
      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('test@example.com', 'wrongpassword', res),
      ).rejects.toThrow(BadRequestException);
      expect(notificationsClient.sendLoginAlert).not.toHaveBeenCalled();
    });

    // An unknown address and a wrong password must be indistinguishable to the
    // caller, otherwise login doubles as a way to discover which addresses have
    // accounts. This asserts the *sameness*, which is the actual requirement —
    // the specific wording is free to change as long as both paths share it.
    it('gives the same answer for an unknown address as for a wrong password', async () => {
      const res = mockResponse();

      jest.spyOn(prismaService.seller, 'findUnique').mockResolvedValue(null);
      const unknownAddress = await service
        .login('nonexistent@example.com', 'password123', res)
        .catch((err: Error) => err);

      jest
        .spyOn(prismaService.seller, 'findUnique')
        .mockResolvedValue(mockSeller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const wrongPassword = await service
        .login('test@example.com', 'wrongpassword', res)
        .catch((err: Error) => err);

      expect(unknownAddress).toBeInstanceOf(BadRequestException);
      expect(wrongPassword).toBeInstanceOf(BadRequestException);
      expect((unknownAddress as Error).message).toBe(
        (wrongPassword as Error).message,
      );
      expect((unknownAddress as Error).message).toBe('Credenciales inválidas');
    });

    it('locks the account once the attempt threshold is reached', async () => {
      const res = mockResponse();
      jest.spyOn(prismaService.seller, 'findUnique').mockResolvedValue({
        ...mockSeller,
        loginAttempts: 7, // one short of MAX_LOGIN_ATTEMPTS
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const update = jest.spyOn(prismaService.seller, 'update');

      await expect(
        service.login('test@example.com', 'wrongpassword', res),
      ).rejects.toThrow(BadRequestException);

      const data = update.mock.calls.at(-1)?.[0]?.data as {
        loginAttempts?: number;
        lockedUntil?: Date | null;
      };
      expect(data.loginAttempts).toBe(8);
      expect(data.lockedUntil).toBeInstanceOf(Date);
    });

    it('refuses a locked account before checking the password', async () => {
      const res = mockResponse();
      jest.spyOn(prismaService.seller, 'findUnique').mockResolvedValue({
        ...mockSeller,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      const compareSpy = bcrypt.compare as jest.Mock;
      compareSpy.mockClear();

      // The i18n mock in this suite only stubs a few keys, so assert the
      // behaviour rather than the rendered string: the request is refused and
      // the password is never even compared.
      await expect(
        service.login('test@example.com', 'password123', res),
      ).rejects.toThrow(BadRequestException);
      expect(compareSpy).not.toHaveBeenCalled();
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
