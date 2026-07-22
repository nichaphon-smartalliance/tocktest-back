import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { GithubTokensService } from './github-tokens.service';
import { GithubToken } from './entities/github-token.entity';
import { Repository as AppRepository } from '../repositories/entities/repository.entity';
import { GithubApiClient } from '../../common/github/github-api.client';
import { encrypt } from '../../common/utils/encryption.util';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const ENCRYPTION_KEY = 'a'.repeat(64);

describe('GithubTokensService', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  let service: GithubTokensService;
  let tokenRepo: { find: jest.Mock; create: jest.Mock; save: jest.Mock; findOne: jest.Mock; remove: jest.Mock; update: jest.Mock; count: jest.Mock };
  let repoRepo: { upsert: jest.Mock };
  let githubApi: { getUser: jest.Mock; getUserEmails: jest.Mock; listAllUserRepos: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    tokenRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'tok-1', ...v })),
      findOne: jest.fn(),
      remove: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    repoRepo = { upsert: jest.fn() };
    githubApi = { getUser: jest.fn(), getUserEmails: jest.fn(), listAllUserRepos: jest.fn().mockResolvedValue([]) };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_SECRET,
          GITHUB_OAUTH_CLIENT_ID: 'client-id',
          GITHUB_OAUTH_CALLBACK_URL: 'https://app.example.com/callback',
        };
        return values[key];
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        GithubTokensService,
        { provide: getRepositoryToken(GithubToken), useValue: tokenRepo },
        { provide: getRepositoryToken(AppRepository), useValue: repoRepo },
        { provide: ConfigService, useValue: config },
        { provide: GithubApiClient, useValue: githubApi },
      ],
    }).compile();

    service = module.get(GithubTokensService);
  });

  describe('create', () => {
    it('encrypts the token before persisting and strips it from the response', async () => {
      const result = await service.create('user-a', { label: 'My PAT', token: 'ghp_secret' });
      expect(tokenRepo.save).toHaveBeenCalled();
      const savedArg = tokenRepo.create.mock.calls[0][0];
      expect(savedArg.tokenEncrypted).not.toBe('ghp_secret');
      expect((result as { tokenEncrypted?: string }).tokenEncrypted).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when the token does not belong to the user', async () => {
      tokenRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('user-a', 'tok-1')).rejects.toThrow(NotFoundException);
      expect(tokenRepo.remove).not.toHaveBeenCalled();
    });

    it('removes the token when it belongs to the user', async () => {
      tokenRepo.findOne.mockResolvedValue({ id: 'tok-1', userId: 'user-a' });
      await service.delete('user-a', 'tok-1');
      expect(tokenRepo.remove).toHaveBeenCalled();
    });
  });

  describe('test', () => {
    it('throws NotFoundException when the token does not exist for this user', async () => {
      tokenRepo.findOne.mockResolvedValue(null);
      await expect(service.test('user-a', 'tok-1')).rejects.toThrow(NotFoundException);
    });

    it('returns valid:true and updates lastTestedAt when GitHub accepts the token', async () => {
      tokenRepo.findOne.mockResolvedValue({ id: 'tok-1', tokenEncrypted: encrypt('ghp_valid') });
      githubApi.getUser.mockResolvedValue({ id: 1, login: 'octocat' });

      const result = await service.test('user-a', 'tok-1');
      expect(result).toEqual({ valid: true });
      expect(tokenRepo.update).toHaveBeenCalledWith('tok-1', expect.objectContaining({ lastTestedAt: expect.any(Date) }));
    });

    it('returns valid:false when GitHub rejects the token', async () => {
      tokenRepo.findOne.mockResolvedValue({ id: 'tok-1', tokenEncrypted: encrypt('ghp_invalid') });
      githubApi.getUser.mockRejectedValue(new Error('401'));

      const result = await service.test('user-a', 'tok-1');
      expect(result).toEqual({ valid: false });
    });
  });

  describe('getDecryptedToken', () => {
    it('returns null when the user has no active token', async () => {
      tokenRepo.findOne.mockResolvedValue(null);
      expect(await service.getDecryptedToken('user-a')).toBeNull();
    });

    it('decrypts and returns the most recent active token', async () => {
      tokenRepo.findOne.mockResolvedValue({ tokenEncrypted: encrypt('ghp_active') });
      expect(await service.getDecryptedToken('user-a')).toBe('ghp_active');
    });
  });

  describe('getOAuthConnectUrl', () => {
    it('throws when OAuth client id/callback are not configured', () => {
      config.get.mockReturnValue(undefined);
      expect(() => service.getOAuthConnectUrl('user-a')).toThrow(BadRequestException);
    });

    it('builds a github.com authorize URL with a signed state param', () => {
      const url = service.getOAuthConnectUrl('user-a');
      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=client-id');
    });
  });

  describe('handleOAuthCallback', () => {
    it('throws UnauthorizedException when state is not a valid JWT', async () => {
      await expect(service.handleOAuthCallback('code', 'not-a-jwt')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when state purpose does not match', async () => {
      const badState = jwt.sign({ userId: 'user-a', purpose: 'something-else' }, JWT_SECRET);
      await expect(service.handleOAuthCallback('code', badState)).rejects.toThrow(UnauthorizedException);
    });
  });
});
