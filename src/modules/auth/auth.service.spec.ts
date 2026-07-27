import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { GithubApiClient } from '../../common/github/github-api.client';

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
        // Real instance (no deps of its own) — tests below still intercept its
        // underlying axios.get calls via jest.spyOn(axios, 'get').
        GithubApiClient,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'GITHUB_OAUTH_CLIENT_ID'
                ? 'test-client-id'
                : key === 'GITHUB_OAUTH_CLIENT_SECRET'
                  ? 'test-client-secret'
                  : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);

    // loginWithGithub now first confirms with GitHub that the presented token was
    // issued to THIS OAuth app. Default to "yes" so the existing cases exercise
    // the behaviour they were written for; the audience check has its own tests.
    jest.spyOn(module.get(GithubApiClient), 'checkOAuthTokenBelongsToApp').mockResolvedValue(true);
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

    // Regression: a GitHub access token is a bearer credential accepted by
    // `GET /user` regardless of which OAuth app minted it. Without an audience
    // check, a token leaked from an unrelated app logs in as its owner here.
    it('rejects a token that was not issued to this OAuth app', async () => {
      const client = (service as unknown as { githubApi: GithubApiClient }).githubApi;
      const audienceSpy = jest
        .spyOn(client, 'checkOAuthTokenBelongsToApp')
        .mockResolvedValue(false);
      const profileSpy = jest.spyOn(axios, 'get');

      await expect(service.loginWithGithub({ accessToken: 'gho_from_other_app' })).rejects.toThrow(
        new UnauthorizedException('GitHub authentication failed'),
      );

      // Fails closed BEFORE the profile is ever fetched.
      expect(profileSpy).not.toHaveBeenCalled();
      audienceSpy.mockRestore();
    });

    it('fails closed when the server has no OAuth app credentials configured', async () => {
      const noConfig = (service as unknown as { config: { get: jest.Mock } }).config;
      noConfig.get.mockReturnValue(undefined);

      await expect(service.loginWithGithub({ accessToken: 'gho_valid' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
