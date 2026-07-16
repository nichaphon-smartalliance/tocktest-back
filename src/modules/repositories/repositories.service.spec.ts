import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ILike, Not, In } from 'typeorm';
import { RepositoriesService } from './repositories.service';
import { Repository } from './entities/repository.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';

const mockRepo = (overrides = {}): Partial<Repository> => ({
  id: 'repo-1',
  userId: 'user-a',
  githubRepoId: 12345,
  fullName: 'owner/my-repo',
  name: 'my-repo',
  ...overrides,
});

describe('RepositoriesService — data isolation', () => {
  let service: RepositoriesService;
  let typeormRepo: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    upsert: jest.Mock;
  };
  let githubTokensService: { getDecryptedToken: jest.Mock };

  beforeEach(async () => {
    typeormRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    };
    githubTokensService = { getDecryptedToken: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RepositoriesService,
        { provide: getRepositoryToken(Repository), useValue: typeormRepo },
        { provide: GithubTokensService, useValue: githubTokensService },
      ],
    }).compile();

    service = module.get(RepositoriesService);
  });

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('always scopes by userId', async () => {
      await service.findAll('user-a', {});
      expect(typeormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-a' } }),
      );
    });

    it('adds fullName ILike filter when search is provided', async () => {
      await service.findAll('user-a', { search: 'my-repo' });
      expect(typeormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-a', fullName: ILike('%my-repo%') } }),
      );
    });

    it('user-a query does not expose user-b data (separate calls have separate where clauses)', async () => {
      await service.findAll('user-a', {});
      const callA = typeormRepo.findAndCount.mock.calls[0][0];
      expect(callA.where.userId).toBe('user-a');

      await service.findAll('user-b', {});
      const callB = typeormRepo.findAndCount.mock.calls[1][0];
      expect(callB.where.userId).toBe('user-b');
    });

    it('defaults to page=1, pageSize=100', async () => {
      await service.findAll('user-a', {});
      expect(typeormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('calculates correct skip for page 2', async () => {
      await service.findAll('user-a', { page: 2, pageSize: 10 });
      expect(typeormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('orders by lastSyncedAt DESC then createdAt DESC', async () => {
      await service.findAll('user-a', {});
      expect(typeormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { lastSyncedAt: 'DESC', createdAt: 'DESC' } }),
      );
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('scopes lookup to both id and userId', async () => {
      typeormRepo.findOne.mockResolvedValue(mockRepo());
      await service.findOne('user-a', 'repo-1');
      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'repo-1', userId: 'user-a' },
      });
    });

    it('throws NotFoundException when repo not found', async () => {
      typeormRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('user-a', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when repo belongs to a different user', async () => {
      typeormRepo.findOne.mockResolvedValue(null); // DB returns null because userId mismatch
      await expect(service.findOne('user-b', 'repo-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getSharedRepoIds ─────────────────────────────────────────────────────

  describe('getSharedRepoIds', () => {
    it('returns array containing the repo id when user owns the repo', async () => {
      typeormRepo.findOne.mockResolvedValue(mockRepo({ id: 'repo-1', userId: 'user-a' }));
      const ids = await service.getSharedRepoIds('user-a', 'repo-1');
      expect(ids).toEqual(['repo-1']);
    });

    it('throws NotFoundException for a repo the user does not own', async () => {
      typeormRepo.findOne.mockResolvedValue(null);
      await expect(service.getSharedRepoIds('user-b', 'repo-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── syncFromGithub — deletion is user-scoped ─────────────────────────────

  describe('syncFromGithub', () => {
    it('throws NotFoundException when no token exists', async () => {
      githubTokensService.getDecryptedToken.mockResolvedValue(null);
      await expect(service.syncFromGithub('user-a')).rejects.toThrow(NotFoundException);
    });

    it('deletes only repos belonging to the requesting user when repos exist', async () => {
      const axios = require('axios');
      const axiosSpy = jest.spyOn(axios, 'get').mockResolvedValue({
        data: [{ id: 99, full_name: 'owner/live', name: 'live', default_branch: 'main', private: false, html_url: '', clone_url: '', owner: { login: 'owner' } }],
      });
      githubTokensService.getDecryptedToken.mockResolvedValue('ghp_token');

      await service.syncFromGithub('user-a');

      expect(typeormRepo.delete).toHaveBeenCalledWith({
        userId: 'user-a',
        githubRepoId: expect.anything(),
      });

      const deleteCall = typeormRepo.delete.mock.calls[0][0];
      expect(deleteCall.userId).toBe('user-a');

      axiosSpy.mockRestore();
    });

    it('deletes all repos for the user when GitHub returns empty list', async () => {
      const axios = require('axios');
      const axiosSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: [] });
      githubTokensService.getDecryptedToken.mockResolvedValue('ghp_token');

      await service.syncFromGithub('user-a');

      expect(typeormRepo.delete).toHaveBeenCalledWith({ userId: 'user-a' });
      axiosSpy.mockRestore();
    });
  });
});
