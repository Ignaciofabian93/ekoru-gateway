import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController, readCredentials } from './auth.controller';
import type { AuthService } from './auth.service';
import type { I18nService } from '../common/i18n';

describe('readCredentials (GW-7)', () => {
  it('takes an email and a password, trimming the email only', () => {
    expect(
      readCredentials({ email: ' ana@example.com ', password: ' secret ' }),
    ).toEqual({ email: 'ana@example.com', password: ' secret ' });
  });

  it.each([
    ['an empty body', {}],
    ['no body', undefined],
    ['null', null],
    ['a list', ['ana@example.com', 'secret']],
    ['a missing password', { email: 'ana@example.com' }],
    ['a missing email', { password: 'secret' }],
    ['an email that is an object', { email: { $ne: '' }, password: 'secret' }],
    ['a password that is a number', { email: 'ana@example.com', password: 1 }],
    ['a blank email', { email: '   ', password: 'secret' }],
    ['an empty password', { email: 'ana@example.com', password: '' }],
    [
      'an email over 254 characters',
      { email: `${'a'.repeat(250)}@example.com`, password: 'secret' },
    ],
    [
      'a password over 200 characters',
      { email: 'ana@example.com', password: 'a'.repeat(201) },
    ],
  ])('refuses %s', (_label, body) => {
    expect(readCredentials(body)).toBeNull();
  });
});

describe('AuthController sign-in', () => {
  const authService = {
    login: jest.fn().mockResolvedValue({ token: 't' }),
    loginAdmin: jest.fn().mockResolvedValue({ token: 't' }),
  };
  const i18n = {
    parseAcceptLanguage: jest.fn().mockReturnValue('ES'),
    translate: jest.fn((key: string) => key),
  };
  const controller = new AuthController(
    authService as unknown as AuthService,
    i18n as unknown as I18nService,
  );
  const res = {} as Response;
  const request = (headers: Record<string, string> = {}) =>
    ({
      headers: { 'user-agent': 'Mozilla/5.0 (test)', ...headers },
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.18.0.1' },
    }) as unknown as Request;

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['auth', () => controller.login({}, request(), res), authService.login],
    [
      'authAdmin',
      () => controller.loginAdmin({}, request(), res),
      authService.loginAdmin,
    ],
  ])(
    'answers 400, not 500, to an empty body on %s (GW-7)',
    async (_route, call, service) => {
      await expect(call()).rejects.toThrow(
        new BadRequestException('auth.invalid_credentials'),
      );
      expect(service).not.toHaveBeenCalled();
    },
  );

  it("reports the address Express trusts, not the caller's X-Forwarded-For (GW-7)", async () => {
    await controller.login(
      { email: 'ana@example.com', password: 'secret' },
      request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }),
      res,
    );

    expect(authService.login).toHaveBeenCalledWith(
      'ana@example.com',
      'secret',
      res,
      'ES',
      { userAgent: 'Mozilla/5.0 (test)', ipAddress: '203.0.113.7' },
    );
  });
});
