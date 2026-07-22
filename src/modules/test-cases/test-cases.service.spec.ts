import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull } from 'typeorm';
import { TestCasesService } from './test-cases.service';
import { TestCase } from './entities/test-case.entity';
import { TestCaseFolder } from './entities/test-case-folder.entity';
import { RepositoriesService } from '../repositories/repositories.service';

const mockTc = (overrides = {}) => ({
  id: 'tc-1',
  repoId: 'repo-1',
  folderId: null,
  title: 'Login works',
  status: 'not_tested',
  priority: 'medium',
  testType: 'manual',
  createdBy: 'user-a',
  isAiGenerated: false,
  ...overrides,
});

const mockFolder = (overrides = {}) => ({
  id: 'folder-1',
  repoId: 'repo-1',
  name: 'Auth',
  parentId: null,
  ...overrides,
});

function makeQueryBuilder(returns: { items: unknown[]; total: number }) {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getManyAndCount: jest.fn().mockResolvedValue([returns.items, returns.total]),
  };
  return qb;
}

describe('TestCasesService', () => {
  let service: TestCasesService;
  let tcRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let folderRepo: { find: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock; remove: jest.Mock };
  let repoService: { findOneForUser: jest.Mock; getSharedRepoIds: jest.Mock };

  beforeEach(async () => {
    tcRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      remove: jest.fn((v) => Promise.resolve(v)),
      createQueryBuilder: jest.fn(() => makeQueryBuilder({ items: [], total: 0 })),
    };
    folderRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      remove: jest.fn((v) => Promise.resolve(v)),
    };
    repoService = {
      findOneForUser: jest.fn().mockResolvedValue({ id: 'repo-1', userId: 'user-a' }),
      getSharedRepoIds: jest.fn().mockResolvedValue(['repo-1']),
    };

    const module = await Test.createTestingModule({
      providers: [
        TestCasesService,
        { provide: getRepositoryToken(TestCase), useValue: tcRepo },
        { provide: getRepositoryToken(TestCaseFolder), useValue: folderRepo },
        { provide: RepositoriesService, useValue: repoService },
      ],
    }).compile();

    service = module.get(TestCasesService);
  });

  // ── Folders ────────────────────────────────────────────────────────────

  describe('getFolders', () => {
    it('resolves shared repo ids for the user before querying folders', async () => {
      await service.getFolders('user-a', 'repo-1');
      expect(repoService.getSharedRepoIds).toHaveBeenCalledWith('user-a', 'repo-1');
    });

    it('queries only top-level folders scoped to the shared repo ids', async () => {
      await service.getFolders('user-a', 'repo-1');
      expect(folderRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { repoId: In(['repo-1']), parentId: IsNull() } }),
      );
    });

    it('propagates NotFoundException when the user does not own/share the repo', async () => {
      repoService.getSharedRepoIds.mockRejectedValue(new NotFoundException('Repository not found'));
      await expect(service.getFolders('user-b', 'repo-1')).rejects.toThrow(NotFoundException);
      expect(folderRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('createFolder', () => {
    it('checks repo ownership before creating', async () => {
      await service.createFolder('user-a', 'repo-1', { name: 'New folder' } as any);
      expect(repoService.findOneForUser).toHaveBeenCalledWith('user-a', 'repo-1');
    });

    it('denies folder creation for a repo the user does not own', async () => {
      repoService.findOneForUser.mockRejectedValue(new NotFoundException('Repository not found'));
      await expect(
        service.createFolder('user-b', 'repo-1', { name: 'x' } as any),
      ).rejects.toThrow(NotFoundException);
      expect(folderRepo.save).not.toHaveBeenCalled();
    });

    it('validates the parent folder belongs to the same repo when parentId is given', async () => {
      folderRepo.findOne.mockResolvedValue(null); // parent not found in this repo
      await expect(
        service.createFolder('user-a', 'repo-1', { name: 'child', parentId: 'other-repo-folder' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates and saves the folder scoped to repoId', async () => {
      const result = await service.createFolder('user-a', 'repo-1', { name: 'New folder' } as any);
      expect(folderRepo.create).toHaveBeenCalledWith({ repoId: 'repo-1', name: 'New folder', parentId: null });
      expect(result).toMatchObject({ repoId: 'repo-1', name: 'New folder' });
    });
  });

  describe('updateFolder', () => {
    it('scopes the folder lookup to shared repo ids and throws when not found', async () => {
      folderRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateFolder('user-b', 'repo-1', 'folder-1', { name: 'renamed' }),
      ).rejects.toThrow(NotFoundException);
      expect(folderRepo.findOne).toHaveBeenCalledWith({ where: { id: 'folder-1', repoId: In(['repo-1']) } });
    });

    it('renames and saves the folder', async () => {
      folderRepo.findOne.mockResolvedValue(mockFolder());
      const result = await service.updateFolder('user-a', 'repo-1', 'folder-1', { name: 'renamed' });
      expect(result.name).toBe('renamed');
      expect(folderRepo.save).toHaveBeenCalled();
    });
  });

  describe('deleteFolder', () => {
    it('throws NotFoundException when folder is not in the user\'s shared repos', async () => {
      folderRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteFolder('user-b', 'repo-1', 'folder-1')).rejects.toThrow(NotFoundException);
      expect(folderRepo.remove).not.toHaveBeenCalled();
    });

    it('removes the folder when found', async () => {
      const folder = mockFolder();
      folderRepo.findOne.mockResolvedValue(folder);
      await service.deleteFolder('user-a', 'repo-1', 'folder-1');
      expect(folderRepo.remove).toHaveBeenCalledWith(folder);
    });
  });

  // ── Test cases — CRUD ─────────────────────────────────────────────────────

  describe('findAll', () => {
    it('scopes the query builder to the user\'s shared repo ids', async () => {
      const qb = makeQueryBuilder({ items: [mockTc()], total: 1 });
      tcRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll('user-a', 'repo-1', {});

      expect(qb.where).toHaveBeenCalledWith('tc.repoId IN (:...repoIds)', { repoIds: ['repo-1'] });
    });

    it('does not leak another user\'s repo id into the filter', async () => {
      repoService.getSharedRepoIds.mockResolvedValue(['repo-a-only']);
      const qb = makeQueryBuilder({ items: [], total: 0 });
      tcRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll('user-a', 'repo-a-only', {});

      expect(qb.where).toHaveBeenCalledWith('tc.repoId IN (:...repoIds)', { repoIds: ['repo-a-only'] });
      expect(qb.where).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ repoIds: ['repo-b'] }));
    });

    it('applies optional filters (status, testType, priority, folderId, search) as andWhere clauses', async () => {
      const qb = makeQueryBuilder({ items: [], total: 0 });
      tcRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll('user-a', 'repo-1', {
        status: 'pass',
        testType: 'ui',
        priority: 'high',
        folderId: 'folder-1',
        search: 'login',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('tc.folderId = :folderId', { folderId: 'folder-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('tc.status = :status', { status: 'pass' });
      expect(qb.andWhere).toHaveBeenCalledWith('tc.testType = :testType', { testType: 'ui' });
      expect(qb.andWhere).toHaveBeenCalledWith('tc.priority = :priority', { priority: 'high' });
      expect(qb.andWhere).toHaveBeenCalledWith('tc.title ILIKE :search', { search: '%login%' });
    });

    it('paginates with default page=1, pageSize=20', async () => {
      const qb = makeQueryBuilder({ items: [], total: 0 });
      tcRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll('user-a', 'repo-1', {});

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('returns a paged result wrapping the query results', async () => {
      const qb = makeQueryBuilder({ items: [mockTc()], total: 1 });
      tcRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll('user-a', 'repo-1', {});

      expect(result.content).toHaveLength(1);
      expect(result.totalElements).toBe(1);
    });
  });

  describe('findOne', () => {
    it('scopes the lookup to the shared repo ids', async () => {
      tcRepo.findOne.mockResolvedValue(mockTc());
      await service.findOne('user-a', 'repo-1', 'tc-1');
      expect(tcRepo.findOne).toHaveBeenCalledWith({ where: { id: 'tc-1', repoId: In(['repo-1']) } });
    });

    it('throws NotFoundException when not found in the user\'s repos', async () => {
      tcRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('user-b', 'repo-1', 'tc-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('checks repo ownership before creating', async () => {
      await service.create('user-a', 'repo-1', { title: 'New TC' } as any);
      expect(repoService.findOneForUser).toHaveBeenCalledWith('user-a', 'repo-1');
    });

    it('denies creation when the user does not own the repo', async () => {
      repoService.findOneForUser.mockRejectedValue(new NotFoundException('Repository not found'));
      await expect(service.create('user-b', 'repo-1', { title: 'x' } as any)).rejects.toThrow(NotFoundException);
      expect(tcRepo.save).not.toHaveBeenCalled();
    });

    it('stamps repoId and createdBy from the request context (not the dto)', async () => {
      const result = await service.create('user-a', 'repo-1', { title: 'New TC' } as any);
      expect(tcRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New TC', repoId: 'repo-1', createdBy: 'user-a' }),
      );
      expect(result).toMatchObject({ repoId: 'repo-1', createdBy: 'user-a' });
    });

    it('validates the folderId belongs to the same repo when given', async () => {
      folderRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create('user-a', 'repo-1', { title: 'x', folderId: 'foreign-folder' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('re-checks user scoping via findOne before writing', async () => {
      tcRepo.findOne.mockResolvedValue(mockTc());
      await service.update('user-a', 'repo-1', 'tc-1', { title: 'updated' });
      expect(tcRepo.findOne).toHaveBeenCalledWith({ where: { id: 'tc-1', repoId: In(['repo-1']) } });
    });

    it('throws NotFoundException instead of updating a test case outside the user\'s repos', async () => {
      tcRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('user-b', 'repo-1', 'tc-1', { title: 'hijacked' }),
      ).rejects.toThrow(NotFoundException);
      expect(tcRepo.save).not.toHaveBeenCalled();
    });

    it('merges the dto onto the existing test case and saves it', async () => {
      tcRepo.findOne.mockResolvedValue(mockTc({ title: 'Old title' }));
      const result = await service.update('user-a', 'repo-1', 'tc-1', { title: 'New title' });
      expect(result.title).toBe('New title');
    });
  });

  describe('delete', () => {
    it('throws NotFoundException instead of deleting a test case outside the user\'s repos', async () => {
      tcRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('user-b', 'repo-1', 'tc-1')).rejects.toThrow(NotFoundException);
      expect(tcRepo.remove).not.toHaveBeenCalled();
    });

    it('removes the test case when found within the user\'s repos', async () => {
      const tc = mockTc();
      tcRepo.findOne.mockResolvedValue(tc);
      await service.delete('user-a', 'repo-1', 'tc-1');
      expect(tcRepo.remove).toHaveBeenCalledWith(tc);
    });
  });

  // ── bulkSave ──────────────────────────────────────────────────────────────

  describe('bulkSave', () => {
    it('checks repo ownership before saving anything', async () => {
      await service.bulkSave('user-a', 'repo-1', { testCases: [{ title: 'A' }] } as any);
      expect(repoService.findOneForUser).toHaveBeenCalledWith('user-a', 'repo-1');
    });

    it('denies bulk save when the user does not own the repo', async () => {
      repoService.findOneForUser.mockRejectedValue(new NotFoundException('Repository not found'));
      await expect(
        service.bulkSave('user-b', 'repo-1', { testCases: [{ title: 'A' }] } as any),
      ).rejects.toThrow(NotFoundException);
      expect(tcRepo.save).not.toHaveBeenCalled();
    });

    it('stamps every item with repoId, createdBy, and isAiGenerated=true', async () => {
      const dto = { testCases: [{ title: 'A' }, { title: 'B' }] } as any;
      const result = await service.bulkSave('user-a', 'repo-1', dto);

      expect(tcRepo.create).toHaveBeenCalledTimes(2);
      expect(tcRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'A', repoId: 'repo-1', createdBy: 'user-a', isAiGenerated: true }),
      );
      expect(result).toHaveLength(2);
      expect(result.every((tc: any) => tc.repoId === 'repo-1' && tc.isAiGenerated)).toBe(true);
    });

    it('validates every distinct folderId referenced by the batch belongs to the repo', async () => {
      folderRepo.findOne.mockResolvedValueOnce(mockFolder({ id: 'folder-1' })).mockResolvedValueOnce(null);
      const dto = {
        testCases: [
          { title: 'A', folderId: 'folder-1' },
          { title: 'B', folderId: 'folder-2' },
        ],
      } as any;

      await expect(service.bulkSave('user-a', 'repo-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('saves nothing when a folder in the batch is invalid', async () => {
      folderRepo.findOne.mockResolvedValue(null);
      const dto = { testCases: [{ title: 'A', folderId: 'bad-folder' }] } as any;
      await expect(service.bulkSave('user-a', 'repo-1', dto)).rejects.toThrow(NotFoundException);
      expect(tcRepo.save).not.toHaveBeenCalled();
    });

    it('returns an empty array when the batch is empty', async () => {
      const result = await service.bulkSave('user-a', 'repo-1', { testCases: [] } as any);
      expect(result).toEqual([]);
    });
  });
});
