import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiService } from './ai.service';
import { Repository } from '../repositories/entities/repository.entity';
import { RepoSettings } from '../settings/entities/repo-settings.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { GithubApiClient } from '../../common/github/github-api.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AiService', () => {
  let service: AiService;
  let repoSettingsRepo: { findOne: jest.Mock };
  let githubApi: {
    listCommits: jest.Mock;
    getCommit: jest.Mock;
    getCommitDiff: jest.Mock;
    getFileText: jest.Mock;
    postIssueComment: jest.Mock;
    postCommitStatus: jest.Mock;
    getPullRequestDetail: jest.Mock;
  };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    jest.resetAllMocks();
    repoSettingsRepo = { findOne: jest.fn().mockResolvedValue(null) };
    githubApi = {
      listCommits: jest.fn(),
      getCommit: jest.fn(),
      getCommitDiff: jest.fn(),
      getFileText: jest.fn(),
      postIssueComment: jest.fn(),
      postCommitStatus: jest.fn(),
      getPullRequestDetail: jest.fn(),
    };
    config = { get: jest.fn((key: string, fallback?: unknown) => fallback) };

    const module = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: config },
        { provide: getRepositoryToken(Repository), useValue: {} },
        { provide: getRepositoryToken(RepoSettings), useValue: repoSettingsRepo },
        { provide: GithubTokensService, useValue: {} },
        { provide: GithubApiClient, useValue: githubApi },
      ],
    }).compile();

    service = module.get(AiService);
  });

  describe('parseJson', () => {
    it('parses raw JSON', () => {
      expect(service.parseJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('extracts JSON from a fenced code block', () => {
      expect(service.parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('returns null for invalid JSON instead of throwing', () => {
      expect(service.parseJson('not json')).toBeNull();
    });
  });

  describe('chat', () => {
    it('returns the AI response content when the call succeeds', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'hello' } }] } });
      const result = await service.chat([{ role: 'user', content: 'hi' }]);
      expect(result).toBe('hello');
    });

    it('falls back to heuristic chat when the AI API call fails', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('network error'));
      const result = await service.chat([{ role: 'user', content: 'hi' }], { language: 'en' });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeCommit', () => {
    it('uses the heuristic analyzer when offline mode is forced', async () => {
      const result = await service.analyzeCommit('{"sha":"abc"}', { forceOffline: true });
      expect(result.source).toBe('heuristic');
    });

    it('uses the heuristic analyzer when the repo has offline mode enabled', async () => {
      repoSettingsRepo.findOne.mockResolvedValue({ aiOfflineMode: true });
      const result = await service.analyzeCommit('{"sha":"abc"}', { repoId: 'repo-1' });
      expect(result.source).toBe('heuristic');
      expect(repoSettingsRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { repoId: 'repo-1' } }),
      );
    });
  });

  describe('getWhatToTest', () => {
    it('uses the heuristic path when offline', async () => {
      const result = await service.getWhatToTest('some commits', { forceOffline: true });
      expect(result.source).toBe('heuristic');
    });
  });

  describe('reviewPullRequest', () => {
    it('returns a heuristic/unavailable result when offline', async () => {
      const result = await service.reviewPullRequest('pr data', { forceOffline: true });
      expect(result.source).toBe('heuristic');
      expect(result.mergeRecommendation).toBe('comment');
    });
  });

  describe('fetchProjectContext', () => {
    it('concatenates README/CLAUDE.md content and skips files that fail to fetch', async () => {
      githubApi.getFileText.mockImplementation((_fullName: string, file: string) =>
        file === 'CLAUDE.md' ? Promise.resolve('claude content') : Promise.resolve(null),
      );

      const context = await service.fetchProjectContext('owner/repo', 'pat');
      expect(context).toContain('CLAUDE.md');
      expect(context).toContain('claude content');
      expect(context).not.toContain('README.md ---\n');
    });
  });

  describe('GitHub helper pass-throughs', () => {
    it('fetchCommits delegates to the GithubApiClient with mapped params', async () => {
      githubApi.listCommits.mockResolvedValue([{ sha: 'abc' }]);
      const commits = await service.fetchCommits('owner/repo', 'pat', { branch: 'main', per_page: 10, page: 2 });
      expect(commits).toEqual([{ sha: 'abc' }]);
      expect(githubApi.listCommits).toHaveBeenCalledWith('owner/repo', 'pat', {
        since: undefined,
        until: undefined,
        per_page: 10,
        page: 2,
        sha: 'main',
      });
    });

    it('fetchCommitDetail delegates to getCommit', async () => {
      githubApi.getCommit.mockResolvedValue({ sha: 'abc' });
      const detail = await service.fetchCommitDetail('owner/repo', 'pat', 'abc');
      expect(detail).toEqual({ sha: 'abc' });
      expect(githubApi.getCommit).toHaveBeenCalledWith('owner/repo', 'abc', 'pat');
    });

    it('postIssueComment delegates to the client', async () => {
      await service.postIssueComment('owner/repo', 'pat', 5, 'nice PR');
      expect(githubApi.postIssueComment).toHaveBeenCalledWith('owner/repo', 5, 'nice PR', 'pat');
    });

    it('postCommitStatus delegates to the client with the default context', async () => {
      await service.postCommitStatus('owner/repo', 'pat', 'sha1', 'success', 'done');
      expect(githubApi.postCommitStatus).toHaveBeenCalledWith('owner/repo', 'sha1', 'success', 'done', 'pat', 'tocktest/ai-review');
    });

    it('fetchPullRequestDetail delegates to getPullRequestDetail', async () => {
      githubApi.getPullRequestDetail.mockResolvedValue({ number: 1 });
      const pr = await service.fetchPullRequestDetail('owner/repo', 'pat', 1);
      expect(pr).toEqual({ number: 1 });
    });
  });

  describe('fetchCommitDiffs', () => {
    it('fetches shas from listCommits when none are provided, then diffs each', async () => {
      githubApi.listCommits.mockResolvedValue([{ sha: 'sha1' }, { sha: 'sha2' }]);
      githubApi.getCommitDiff.mockResolvedValue('diff content');

      const diffs = await service.fetchCommitDiffs('owner/repo', 'pat', {});
      expect(diffs).toContain('sha1');
      expect(diffs).toContain('diff content');
    });

    it('returns null when the GitHub calls fail', async () => {
      githubApi.listCommits.mockRejectedValue(new Error('network error'));
      const diffs = await service.fetchCommitDiffs('owner/repo', 'pat', {});
      expect(diffs).toBeNull();
    });
  });
});
