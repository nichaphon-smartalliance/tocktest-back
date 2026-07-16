import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

const baseUser = {
  id: 'u1',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'user',
  isActive: true,
  authProvider: 'local',
  avatarUrl: null,
  githubLogin: null,
  sessionVersion: 1,
  createdAt: new Date('2024-01-01'),
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; findById: jest.Mock; upsertGithubUser: jest.Mock };
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      upsertGithubUser: jest.fn(),
    };
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ── login ──────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns accessToken and user on valid credentials', async () => {
      const hash = await bcrypt.hash('password123', 1);
      usersService.findByEmail.mockResolvedValue({ ...baseUser, passwordHash: hash });

      const result = await service.login({ email: 'alice@example.com', password: 'password123' });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user.email).toBe('alice@example.com');
    });

    it('throws when user is not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(service.login({ email: 'ghost@example.com', password: 'x' })).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('throws when user has no passwordHash', async () => {
      usersService.findByEmail.mockResolvedValue({ ...baseUser, passwordHash: null });
      await expect(service.login({ email: 'alice@example.com', password: 'x' })).rejects.toThrow(UnauthorizedException);
    });

    it('throws on wrong password', async () => {
      const hash = await bcrypt.hash('correct', 1);
      usersService.findByEmail.mockResolvedValue({ ...baseUser, passwordHash: hash });
      await expect(service.login({ email: 'alice@example.com', password: 'wrong' })).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a $2a$ prefixed hash by normalising it to $2b$', async () => {
      // bcryptjs generates $2b$ hashes; replace prefix to simulate pgcrypto's $2a$
      const originalHash = await bcrypt.hash('mypassword', 1);
      const legacyHash = originalHash.replace(/^\$2b\$/, '$2a$');
      usersService.findByEmail.mockResolvedValue({ ...baseUser, passwordHash: legacyHash });

      const result = await service.login({ email: 'alice@example.com', password: 'mypassword' });
      expect(result.accessToken).toBeDefined();
    });

    it('returns all expected user fields in the session', async () => {
      const hash = await bcrypt.hash('pass', 1);
      usersService.findByEmail.mockResolvedValue({ ...baseUser, passwordHash: hash });

      const { user } = await service.login({ email: 'alice@example.com', password: 'pass' });
      expect(user).toMatchObject({
        id: 'u1',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        isActive: true,
      });
      expect((user as any).passwordHash).toBeUndefined();
    });
  });

  // ── loginWithGithub ────────────────────────────────────────────────────────

  describe('loginWithGithub', () => {
    let axiosSpy: jest.SpyInstance;

    function mockGithubSuccess() {
      axiosSpy = jest.spyOn(axios, 'get').mockImplementation((url: string) => {
        if ((url as string).includes('/user/emails')) {
          return Promise.resolve({
            data: [{ email: 'gh@example.com', primary: true, verified: true }],
          }) as any;
        }
        return Promise.resolve({
          data: { id: 42, login: 'ghuser', name: 'GH User', avatar_url: 'https://github.com/avatar.png' },
        }) as any;
      });
    }

    afterEach(() => {
      axiosSpy?.mockRestore();
    });

    it('returns a session for a valid GitHub token', async () => {
      mockGithubSuccess();
      usersService.upsertGithubUser.mockResolvedValue({ ...baseUser, authProvider: 'github' });

      const result = await service.loginWithGithub({ accessToken: 'gho_valid' });
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it('throws when the GitHub user account is disabled', async () => {
      mockGithubSuccess();
      usersService.upsertGithubUser.mockResolvedValue({ ...baseUser, isActive: false });

      await expect(service.loginWithGithub({ accessToken: 'gho_valid' })).rejects.toThrow(
        new UnauthorizedException('This account is disabled'),
      );
    });

    it('throws when axios call fails', async () => {
      axiosSpy = jest.spyOn(axios, 'get').mockRejectedValue(new Error('network error'));
      await expect(service.loginWithGithub({ accessToken: 'bad_token' })).rejects.toThrow(
        new UnauthorizedException('GitHub authentication failed'),
      );
    });

    it('throws when GitHub profile is missing id', async () => {
      axiosSpy = jest.spyOn(axios, 'get').mockImplementation((url: string) => {
        if ((url as string).includes('/user/emails')) {
          return Promise.resolve({ data: [] }) as any;
        }
        return Promise.resolve({ data: { login: 'ghuser' } }) as any; // missing id
      });
      await expect(service.loginWithGithub({ accessToken: 'bad_token' })).rejects.toThrow(UnauthorizedException);
    });

    it('picks the primary verified email from the emails response', async () => {
      axiosSpy = jest.spyOn(axios, 'get').mockImplementation((url: string) => {
        if ((url as string).includes('/user/emails')) {
          return Promise.resolve({
            data: [
              { email: 'secondary@example.com', primary: false, verified: true },
              { email: 'primary@example.com', primary: true, verified: true },
            ],
          }) as any;
        }
        return Promise.resolve({ data: { id: 42, login: 'ghuser' } }) as any;
      });
      usersService.upsertGithubUser.mockResolvedValue({ ...baseUser });

      await service.loginWithGithub({ accessToken: 'gho_valid' });

      expect(usersService.upsertGithubUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'primary@example.com' }),
      );
    });
  });
});
