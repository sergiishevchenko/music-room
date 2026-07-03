import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';

jest.mock('bcrypt');

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  subscription: { create: jest.fn() },
};

const mockJwt = {
  signAsync: jest.fn().mockResolvedValue('mock-token'),
  verifyAsync: jest.fn(),
};

const mockConfig = {
  get: jest.fn().mockReturnValue('test-secret'),
};

const mockMail = {
  sendVerificationEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get(AuthService);
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    global.fetch = jest.fn();
  });

  describe('register', () => {
    it('throws if email exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '1' });
      await expect(
        service.register({ email: 'a@b.com', password: 'pass123', name: 'A' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user and returns tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: '1',
        email: 'a@b.com',
        name: 'A',
        passwordHash: 'hashed',
      });
      mockPrisma.subscription.create.mockResolvedValue({});

      const result = await service.register({
        email: 'a@b.com',
        password: 'pass123',
        name: 'A',
      });

      expect(result.accessToken).toBeDefined();
      expect(mockMail.sendVerificationEmail).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('throws for unknown email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'x@y.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws for wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'a@b.com',
        passwordHash: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns tokens on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'a@b.com',
        passwordHash: 'hashed',
      });
      const result = await service.login({ email: 'a@b.com', password: 'pass' });
      expect(result.accessToken).toBeDefined();
    });
  });

  describe('googleAuth', () => {
    it('throws for invalid token', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
      await expect(service.googleAuth('bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('creates new user', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          sub: 'g1',
          email: 'g@test.com',
          name: 'Google User',
        }),
      });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValue({
        id: '1',
        email: 'g@test.com',
        name: 'Google User',
      });
      mockPrisma.subscription.create.mockResolvedValue({});

      const result = await service.googleAuth('token');
      expect(result.user.email).toBe('g@test.com');
    });

    it('links existing email user', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ sub: 'g1', email: 'g@test.com', name: 'G' }),
      });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: '1', email: 'g@test.com' });
      mockPrisma.user.update.mockResolvedValue({
        id: '1',
        email: 'g@test.com',
      });

      const result = await service.googleAuth('token');
      expect(result.user.id).toBe('1');
    });

    it('returns existing google user', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ sub: 'g1', email: 'g@test.com' }),
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'g@test.com',
      });

      const result = await service.googleAuth('token');
      expect(result.user.id).toBe('1');
    });
  });

  describe('facebookAuth', () => {
    it('throws for invalid token', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
      await expect(service.facebookAuth('bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('creates new facebook user without email', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'fb1', name: 'FB User' }),
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: '1',
        email: 'fb1@facebook.com',
        name: 'FB User',
      });
      mockPrisma.subscription.create.mockResolvedValue({});

      const result = await service.facebookAuth('token');
      expect(result.user.name).toBe('FB User');
    });

    it('links existing email user', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'fb1', email: 'fb@test.com', name: 'FB' }),
      });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: '1', email: 'fb@test.com' });
      mockPrisma.user.update.mockResolvedValue({
        id: '1',
        email: 'fb@test.com',
      });

      const result = await service.facebookAuth('token');
      expect(result.user.id).toBe('1');
    });
  });

  describe('verifyEmail', () => {
    it('throws for invalid token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.verifyEmail('bad')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('verifies email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: '1' });
      mockPrisma.user.update.mockResolvedValue({});
      const result = await service.verifyEmail('valid');
      expect(result.message).toBe('Email verified successfully');
    });
  });

  describe('forgotPassword', () => {
    it('returns generic message when user missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword({ email: 'x@y.com' });
      expect(result.message).toContain('reset link');
    });

    it('sends reset email when user exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'a@b.com' });
      mockPrisma.user.update.mockResolvedValue({});
      const result = await service.forgotPassword({ email: 'a@b.com' });
      expect(mockMail.sendPasswordResetEmail).toHaveBeenCalled();
      expect(result.message).toContain('reset link');
    });
  });

  describe('resetPassword', () => {
    it('throws for invalid token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.resetPassword({ token: 'bad', newPassword: 'newpass123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resets password', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: '1' });
      mockPrisma.user.update.mockResolvedValue({});
      const result = await service.resetPassword({
        token: 'valid',
        newPassword: 'newpass123',
      });
      expect(result.message).toBe('Password reset successfully');
    });
  });

  describe('refreshTokens', () => {
    it('throws for invalid token', async () => {
      mockJwt.verifyAsync.mockRejectedValue(new Error('invalid'));
      await expect(service.refreshTokens('bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns new tokens', async () => {
      mockJwt.verifyAsync.mockResolvedValue({ sub: '1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'a@b.com',
      });
      const result = await service.refreshTokens('valid-refresh');
      expect(result.accessToken).toBeDefined();
    });

    it('throws when user not found', async () => {
      mockJwt.verifyAsync.mockResolvedValue({ sub: '1' });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.refreshTokens('valid')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('linkGoogle', () => {
    it('throws for invalid token', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
      await expect(service.linkGoogle('u1', 'bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when google linked to another user', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ sub: 'g1' }),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'other' });
      await expect(service.linkGoogle('u1', 'token')).rejects.toThrow(
        ConflictException,
      );
    });

    it('links google account', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ sub: 'g1' }),
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue({ id: 'u1', googleId: 'g1' });
      const result = await service.linkGoogle('u1', 'token');
      expect(result.googleId).toBe('g1');
    });
  });

  describe('linkFacebook', () => {
    it('throws for invalid token', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
      await expect(service.linkFacebook('u1', 'bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when facebook linked to another user', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'fb1' }),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'other' });
      await expect(service.linkFacebook('u1', 'token')).rejects.toThrow(
        ConflictException,
      );
    });

    it('links facebook account', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'fb1' }),
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue({ id: 'u1', facebookId: 'fb1' });
      const result = await service.linkFacebook('u1', 'token');
      expect(result.facebookId).toBe('fb1');
    });
  });
});
