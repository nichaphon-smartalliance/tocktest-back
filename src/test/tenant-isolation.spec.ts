import { NotFoundException } from '@nestjs/common';
import { RepositoriesService } from '../modules/repositories/repositories.service';
import { TestCasesService } from '../modules/test-cases/test-cases.service';
import { SettingsService } from '../modules/settings/settings.service';
import { DocsService } from '../modules/docs/docs.service';

/**
 * Two-user IDOR / tenant-isolation suite.
 *
 * Every read/write in the app is supposed to be scoped to the requesting user
 * via RepositoriesService.findOneForUser / getSharedRepoIds. These tests wire
 * the REAL services together over a mock "repositories" table that honours the
 * `userId` column (exactly like the SQL WHERE clause), then prove that User B
 * cannot reach a repository owned by User A through any consuming service.
 */

const USER_A = 'user-a-uuid';
const USER_B = 'user-b-uuid';
const REPO_A = 'repo-a-uuid';

interface Row {
  [key: string]: unknown;
}

// Minimal TypeORM-style repo mock whose findOne honours EVERY key in `where`
// (id AND userId), so a cross-user lookup returns null just like the database.
function makeTable(rows: Row[]) {
  const matches = (row: Row, cond: Row) =>
    Object.entries(cond).every(([k, v]) => row[k] === v);
  return {
    findOne: jest.fn(({ where }: { where: Row | Row[] }) => {
      const conds = Array.isArray(where) ? where : [where];
      return Promise.resolve(rows.find((r) => conds.some((c) => matches(r, c))) ?? null);
    }),
    find: jest.fn(({ where }: { where: Row | Row[] }) => {
      const conds = Array.isArray(where) ? where : [where];
      return Promise.resolve(rows.filter((r) => conds.some((c) => matches(r, c))));
    }),
  };
}

describe('Tenant isolation (two-user IDOR)', () => {
  let repoService: RepositoriesService;
  let testCases: TestCasesService;
  let settings: SettingsService;
  let docs: DocsService;

  beforeEach(() => {
    // A single repository row owned by User A.
    const repoTable = makeTable([{ id: REPO_A, userId: USER_A, defaultBranch: 'main', fullName: 'a/repo' }]);
    const githubTokens = { getDecryptedToken: jest.fn().mockResolvedValue(null) };
    const githubApi = { listAllUserRepos: jest.fn(), listAllBranches: jest.fn() };

    repoService = new RepositoriesService(repoTable as any, githubTokens as any, githubApi as any);

    const folderTable = makeTable([]);
    const tcTable = makeTable([]);
    const settingsTable = { ...makeTable([]), create: jest.fn((v) => v), save: jest.fn((v) => Promise.resolve(v)) };
    const docTable = makeTable([]);
    const users = { findById: jest.fn() };

    testCases = new TestCasesService(tcTable as any, folderTable as any, repoService);
    settings = new SettingsService(settingsTable as any, repoService);
    const docsSource = {
      fetchBranchHead: jest.fn(),
      fetchRepoTree: jest.fn(),
      fetchChangedPaths: jest.fn(),
      fetchFileContent: jest.fn(),
      describeGenerationError: jest.fn(),
    };
    docs = new DocsService(docTable as any, settingsTable as any, repoService, githubTokens as any, users as any, docsSource as any);
  });

  describe('the owner (User A) can reach their repo', () => {
    it('findOneForUser returns the repo', async () => {
      await expect(repoService.findOneForUser(USER_A, REPO_A)).resolves.toMatchObject({ id: REPO_A });
    });

    it('getSharedRepoIds returns the repo id', async () => {
      await expect(repoService.getSharedRepoIds(USER_A, REPO_A)).resolves.toEqual([REPO_A]);
    });
  });

  describe('a different user (User B) is denied across every service', () => {
    it('RepositoriesService.findOneForUser throws NotFound', async () => {
      await expect(repoService.findOneForUser(USER_B, REPO_A)).rejects.toThrow(NotFoundException);
    });

    it('RepositoriesService.findOne throws NotFound', async () => {
      await expect(repoService.findOne(USER_B, REPO_A)).rejects.toThrow(NotFoundException);
    });

    it('TestCasesService.getFolders throws NotFound (via getSharedRepoIds)', async () => {
      await expect(testCases.getFolders(USER_B, REPO_A)).rejects.toThrow(NotFoundException);
    });

    it('SettingsService.getSettings throws NotFound', async () => {
      await expect(settings.getSettings(USER_B, REPO_A)).rejects.toThrow(NotFoundException);
    });

    it('DocsService.getLatestDoc throws NotFound', async () => {
      await expect(docs.getLatestDoc(USER_B, REPO_A)).rejects.toThrow(NotFoundException);
    });

    it('DocsService.updateDoc (write) throws NotFound', async () => {
      await expect(docs.updateDoc(USER_B, REPO_A, 'malicious content')).rejects.toThrow(NotFoundException);
    });
  });

  describe('guessing a non-existent repo id is also denied', () => {
    it('findOneForUser throws NotFound for an unknown id', async () => {
      await expect(repoService.findOneForUser(USER_A, 'does-not-exist')).rejects.toThrow(NotFoundException);
    });
  });
});
