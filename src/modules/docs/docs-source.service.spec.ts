import axios from 'axios';
import { DocsSourceService } from './docs-source.service';
import { GithubApiClient } from '../../common/github/github-api.client';

describe('DocsSourceService', () => {
  let service: DocsSourceService;
  let githubApi: {
    getBranch: jest.Mock;
    getTree: jest.Mock;
    compareCommits: jest.Mock;
    getFileContent: jest.Mock;
  };

  beforeEach(() => {
    githubApi = {
      getBranch: jest.fn(),
      getTree: jest.fn(),
      compareCommits: jest.fn(),
      getFileContent: jest.fn(),
    };
    service = new DocsSourceService(githubApi as unknown as GithubApiClient);
  });

  describe('fetchBranchHead', () => {
    it('extracts commit sha and tree sha from the branch response', async () => {
      githubApi.getBranch.mockResolvedValue({
        commit: { sha: 'commit-sha', commit: { tree: { sha: 'tree-sha' } } },
      });

      const head = await service.fetchBranchHead('owner/repo', 'token', 'main');
      expect(head).toEqual({ commitSha: 'commit-sha', treeSha: 'tree-sha' });
    });
  });

  describe('fetchRepoTree', () => {
    it('returns the tree array', async () => {
      githubApi.getTree.mockResolvedValue({ tree: [{ path: 'src/a.ts', sha: 's', type: 'blob' }] });
      const tree = await service.fetchRepoTree('owner/repo', 'token', 'tree-sha');
      expect(tree).toHaveLength(1);
    });

    it('returns an empty array when the response has no tree', async () => {
      githubApi.getTree.mockResolvedValue({});
      const tree = await service.fetchRepoTree('owner/repo', 'token', 'tree-sha');
      expect(tree).toEqual([]);
    });
  });

  describe('fetchChangedPaths', () => {
    it('returns an empty array when base and head are identical (no API call)', async () => {
      const paths = await service.fetchChangedPaths('owner/repo', 'token', 'sha1', 'sha1');
      expect(paths).toEqual([]);
      expect(githubApi.compareCommits).not.toHaveBeenCalled();
    });

    it('extracts filenames from the compare response', async () => {
      githubApi.compareCommits.mockResolvedValue({ files: [{ filename: 'src/a.ts' }, { filename: 'src/b.ts' }] });
      const paths = await service.fetchChangedPaths('owner/repo', 'token', 'sha1', 'sha2');
      expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('filters out files with empty/missing filenames', async () => {
      githubApi.compareCommits.mockResolvedValue({ files: [{ filename: '' }, { filename: 'src/b.ts' }] });
      const paths = await service.fetchChangedPaths('owner/repo', 'token', 'sha1', 'sha2');
      expect(paths).toEqual(['src/b.ts']);
    });
  });

  describe('fetchFileContent', () => {
    it('base64-decodes the file content', async () => {
      githubApi.getFileContent.mockResolvedValue({ content: Buffer.from('hello').toString('base64'), encoding: 'base64', sha: 's' });
      const content = await service.fetchFileContent('owner/repo', 'token', 'README.md', 'sha1');
      expect(content).toBe('hello');
    });

    it('returns empty string when content is not a string', async () => {
      githubApi.getFileContent.mockResolvedValue({ content: undefined, encoding: '', sha: 's' });
      const content = await service.fetchFileContent('owner/repo', 'token', 'README.md', 'sha1');
      expect(content).toBe('');
    });
  });

  describe('describeGenerationError', () => {
    it('gives a specific message for 401 (invalid/expired token)', () => {
      const error = { isAxiosError: true, response: { status: 401, data: {} } };
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      expect(service.describeGenerationError(error)).toContain('token is invalid or expired');
    });

    it('gives a specific message for 403 (access denied/rate limited)', () => {
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      const error = { response: { status: 403, data: {} } };
      expect(service.describeGenerationError(error)).toContain('denied access');
    });

    it('gives a specific message for 404 (repo/branch not found)', () => {
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      const error = { response: { status: 404, data: {} } };
      expect(service.describeGenerationError(error)).toContain('was not found on GitHub');
    });

    it('surfaces the GitHub API message for other status codes', () => {
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      const error = { response: { status: 422, data: { message: 'Validation failed' } } };
      expect(service.describeGenerationError(error)).toBe('GitHub API error: Validation failed');
    });

    it('falls back to the Error message for non-axios errors', () => {
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
      expect(service.describeGenerationError(new Error('boom'))).toBe('boom');
    });

    it('falls back to a generic message for unrecognized error shapes', () => {
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
      expect(service.describeGenerationError('not an error object')).toBe('Documentation generation failed.');
    });
  });
});
