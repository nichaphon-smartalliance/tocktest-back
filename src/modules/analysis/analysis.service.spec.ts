import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { AnalysisService } from './analysis.service';
import { CommitAnalysis } from './entities/commit-analysis.entity';
import { AiService } from '../ai/ai.service';
import { RepositoriesService } from '../repositories/repositories.service';
import { GithubTokensService } from '../github-tokens/github-tokens.service';

describe('AnalysisService', () => {
  let service: AnalysisService;
  let commitRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let aiService: {
    fetchCommits: jest.Mock;
    fetchCommitDetail: jest.Mock;
    analyzeCommit: jest.Mock;
    getWhatToTest: jest.Mock;
    fetchPullRequestDetail: jest.Mock;
    reviewPullRequest: jest.Mock;
    postIssueComment: jest.Mock;
    postCommitStatus: jest.Mock;
  };
  let repoService: { findOneForUser: jest.Mock };
  let githubTokensService: { getDecryptedToken: jest.Mock };

  const repo = { id: 'repo-1', userId: 'user-a', fullName: 'owner/repo' };

  beforeEach(async () => {
    commitRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((v) => Promise.resolve(v)),
      create: jest.fn((v) => v),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      }),
    };
    aiService = {
      fetchCommits: jest.fn().mockResolvedValue([]),
      fetchCommitDetail: jest.fn(),
      analyzeCommit: jest.fn(),
      getWhatToTest: jest.fn(),
      fetchPullRequestDetail: jest.fn(),
      reviewPullRequest: jest.fn(),
      postIssueComment: jest.fn(),
      postCommitStatus: jest.fn(),
    };
    repoService = { findOneForUser: jest.fn().mockResolvedValue(repo) };
    githubTokensService = { getDecryptedToken: jest.fn().mockResolvedValue(null) };

    const module = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: getRepositoryToken(CommitAnalysis), useValue: commitRepo },
        { provide: AiService, useValue: aiService },
        { provide: RepositoriesService, useValue: repoService },
        { provide: GithubTokensService, useValue: githubTokensService },
      ],
    }).compile();

    service = module.get(AnalysisService);
  });

  describe('getCommits', () => {
    it('always scopes the repo lookup to the requesting user', async () => {
      await service.getCommits('user-a', 'repo-1', {});
      expect(repoService.findOneForUser).toHaveBeenCalledWith('user-a', 'repo-1');
    });

    it('fetches live from GitHub when a branch and PAT are both present', async () => {
      githubTokensService.getDecryptedToken.mockResolvedValue('pat');
      aiService.fetchCommits.mockResolvedValue([{ sha: 'a1', commit: { message: 'msg' } }]);

      const result = await service.getCommits('user-a', 'repo-1', { branch: 'main', pageSize: 10 });

      expect(aiService.fetchCommits).toHaveBeenCalled();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].commitSha).toBe('a1');
    });

    it('falls back to stored analyses when there is no branch/PAT', async () => {
      const result = await service.getCommits('user-a', 'repo-1', {});
      expect(aiService.fetchCommits).not.toHaveBeenCalled();
      expect(result.content).toEqual([]);
    });
  });

  describe('analyzeCommit', () => {
    it('throws NotFoundException when no GitHub token exists', async () => {
      githubTokensService.getDecryptedToken.mockResolvedValue(null);
      await expect(service.analyzeCommit('user-a', 'repo-1', 'sha1')).rejects.toThrow(NotFoundException);
    });

    it('fetches commit detail, analyzes it, and persists the result', async () => {
      githubTokensService.getDecryptedToken.mockResolvedValue('pat');
      aiService.fetchCommitDetail.mockResolvedValue({
        sha: 'sha1',
        commit: { message: 'fix bug', author: { name: 'Alice', email: 'a@b.com', date: '2024-01-01T00:00:00Z' } },
        stats: { total: 5, additions: 3, deletions: 2 },
      });
      aiService.analyzeCommit.mockResolvedValue({ summary: 'Looks fine', riskLevel: 'low' });

      const result = await service.analyzeCommit('user-a', 'repo-1', 'sha1');

      expect(result.summary).toBe('Looks fine');
      expect(commitRepo.save).toHaveBeenCalled();
    });
  });

  describe('getWhatToTest', () => {
    it('returns a fallback response when no commit data is available and no token exists', async () => {
      const result = await service.getWhatToTest('user-a', 'repo-1', ['sha1']);
      expect(result.recommendations).toEqual([]);
      expect(aiService.getWhatToTest).not.toHaveBeenCalled();
    });

    it('delegates to AiService when commit data is available', async () => {
      commitRepo.find.mockResolvedValue([
        { commitSha: 'sha1', commitMessage: 'fix', aiSummary: 'summary' },
      ]);
      aiService.getWhatToTest.mockResolvedValue({ recommendations: ['test x'], priority: 'high', reasoning: 'r' });

      const result = await service.getWhatToTest('user-a', 'repo-1', ['sha1']);
      expect(result.recommendations).toEqual(['test x']);
    });
  });

  describe('reviewAndCommentPullRequest', () => {
    it('throws NotFoundException without a GitHub token', async () => {
      await expect(service.reviewAndCommentPullRequest('user-a', 'repo-1', 1)).rejects.toThrow(NotFoundException);
    });

    it('posts a comment and commit status after reviewing', async () => {
      githubTokensService.getDecryptedToken.mockResolvedValue('pat');
      aiService.fetchPullRequestDetail.mockResolvedValue({ number: 1, head: { sha: 'headsha' } });
      aiService.reviewPullRequest.mockResolvedValue({
        summary: 'Good',
        riskLevel: 'low',
        findings: [],
        mergeRecommendation: 'approve',
      });

      const result = await service.reviewAndCommentPullRequest('user-a', 'repo-1', 1);

      expect(aiService.postIssueComment).toHaveBeenCalled();
      expect(aiService.postCommitStatus).toHaveBeenCalledWith(
        'owner/repo',
        'pat',
        'headsha',
        'success',
        expect.any(String),
      );
      expect(result.posted).toBe(true);
    });
  });
});
