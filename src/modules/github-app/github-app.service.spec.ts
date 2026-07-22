import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { GithubAppService } from './github-app.service';
import { GithubInstallation } from './entities/github-installation.entity';
import { Repository } from '../repositories/entities/repository.entity';
import { GithubApiClient } from '../../common/github/github-api.client';

describe('GithubAppService', () => {
  let service: GithubAppService;
  let installationRepo: { findOne: jest.Mock; find: jest.Mock; upsert: jest.Mock };
  let repoRepo: { find: jest.Mock; upsert: jest.Mock };
  let githubApi: { listInstallationRepositories: jest.Mock; getRepo: jest.Mock; postIssueComment: jest.Mock; postCommitStatus: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    installationRepo = { findOne: jest.fn(), find: jest.fn(), upsert: jest.fn() };
    repoRepo = { find: jest.fn().mockResolvedValue([]), upsert: jest.fn() };
    githubApi = {
      listInstallationRepositories: jest.fn().mockResolvedValue([]),
      getRepo: jest.fn(),
      postIssueComment: jest.fn(),
      postCommitStatus: jest.fn(),
    };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          GITHUB_APP_ID: '12345',
          GITHUB_APP_PRIVATE_KEY:
            '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK1v\n-----END RSA PRIVATE KEY-----',
          JWT_SECRET: 'test-secret-at-least-32-characters-long',
        };
        return values[key];
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        GithubAppService,
        { provide: ConfigService, useValue: config },
        { provide: getRepositoryToken(GithubInstallation), useValue: installationRepo },
        { provide: getRepositoryToken(Repository), useValue: repoRepo },
        { provide: GithubApiClient, useValue: githubApi },
      ],
    }).compile();

    service = module.get(GithubAppService);
  });

  describe('getSetupStatus', () => {
    it('reports configured when app id and private key are both set', () => {
      const status = service.getSetupStatus();
      expect(status.configured).toBe(true);
      expect(status.appIdConfigured).toBe(true);
      expect(status.privateKeyConfigured).toBe(true);
    });

    it('reports not configured when the private key is missing', () => {
      config.get.mockImplementation((key: string) => (key === 'GITHUB_APP_ID' ? '12345' : undefined));
      const status = service.getSetupStatus();
      expect(status.configured).toBe(false);
    });
  });

  describe('getInstallationRepositories', () => {
    it('throws when the installation does not belong to the user', async () => {
      installationRepo.findOne.mockResolvedValue(null);
      await expect(service.getInstallationRepositories('user-a', 'inst-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('importInstallationRepository', () => {
    it('rejects a repo full name that is not a plain owner/repo slug', async () => {
      await expect(
        service.importInstallationRepository('user-a', 'inst-1', '../../etc/passwd'),
      ).rejects.toThrow(BadRequestException);
      expect(installationRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws when the installation does not belong to the user', async () => {
      installationRepo.findOne.mockResolvedValue(null);
      await expect(
        service.importInstallationRepository('user-a', 'inst-1', 'owner/repo'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleInstallationCallback', () => {
    it('returns installationId/setupAction without a userId when state is missing', async () => {
      const result = await service.handleInstallationCallback('inst-1', 'install', undefined);
      expect(result).toEqual({ userId: null, installationId: 'inst-1', setupAction: 'install' });
      expect(installationRepo.upsert).not.toHaveBeenCalled();
    });
  });
});
