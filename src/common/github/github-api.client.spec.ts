import axios from 'axios';
import { GithubApiClient } from './github-api.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GithubApiClient', () => {
  let client: GithubApiClient;

  beforeEach(() => {
    client = new GithubApiClient();
    jest.resetAllMocks();
  });

  describe('listAllUserRepos', () => {
    it('paginates until a short page is returned', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const lastPage = [{ id: 999 }];
      mockedAxios.get
        .mockResolvedValueOnce({ data: fullPage })
        .mockResolvedValueOnce({ data: lastPage });

      const repos = await client.listAllUserRepos('token-a', 'owner');

      expect(repos).toHaveLength(101);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        1,
        'https://api.github.com/user/repos',
        expect.objectContaining({ params: expect.objectContaining({ page: 1, type: 'owner' }) }),
      );
    });

    it('omits the type filter when not requested (OAuth sync behaviour)', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [] });
      await client.listAllUserRepos('token-a');
      const params = mockedAxios.get.mock.calls[0][1]?.params;
      expect(params).not.toHaveProperty('type');
    });

    it('stops after a single page when fewer than 100 results are returned', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }] });
      const repos = await client.listAllUserRepos('token-a', 'owner');
      expect(repos).toHaveLength(2);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFileText', () => {
    it('base64-decodes file content', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { content: Buffer.from('hello world').toString('base64'), encoding: 'base64', sha: 'x' },
      });
      const text = await client.getFileText('owner/repo', 'README.md', 'token');
      expect(text).toBe('hello world');
    });

    it('returns null instead of throwing when the request fails (e.g. 404)', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Not Found'));
      const text = await client.getFileText('owner/repo', 'missing.md', 'token');
      expect(text).toBeNull();
    });
  });

  describe('postCommitStatus', () => {
    it('truncates the description to 140 characters', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: {} });
      const longDescription = 'x'.repeat(200);
      await client.postCommitStatus('owner/repo', 'sha1', 'success', longDescription, 'token');

      const body = mockedAxios.post.mock.calls[0][1] as { description: string };
      expect(body.description).toHaveLength(140);
    });
  });

  describe('listInstallationRepositories', () => {
    it('unwraps the repositories array from the response envelope', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { total_count: 1, repositories: [{ id: 1 }] } });
      const repos = await client.listInstallationRepositories('installation-token');
      expect(repos).toEqual([{ id: 1 }]);
    });

    it('returns an empty array when repositories is missing', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: {} });
      const repos = await client.listInstallationRepositories('installation-token');
      expect(repos).toEqual([]);
    });
  });

  describe('getPullRequestDetail', () => {
    it('merges the PR and its files into one object', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { number: 1, title: 'PR', body: null } })
        .mockResolvedValueOnce({ data: [{ filename: 'a.ts' }] });

      const detail = await client.getPullRequestDetail('owner/repo', 1, 'token');
      expect(detail.files).toEqual([{ filename: 'a.ts' }]);
      expect(detail.number).toBe(1);
    });
  });
});
