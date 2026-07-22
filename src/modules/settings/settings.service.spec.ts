import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingsService } from './settings.service';
import { RepoSettings } from './entities/repo-settings.entity';
import { RepositoriesService } from '../repositories/repositories.service';

const mockRepoRow = (overrides = {}) => ({
  id: 'repo-1',
  userId: 'user-a',
  defaultBranch: 'main',
  ...overrides,
});

const mockSettingsRow = (overrides = {}): Partial<RepoSettings> => ({
  id: 'settings-1',
  repoId: 'repo-1',
  defaultBranch: 'main',
  autoAnalyzeOnPush: false,
  aiOfflineMode: false,
  ...overrides,
});

describe('SettingsService', () => {
  let service: SettingsService;
  let settingsRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let repoService: { findOneForUser: jest.Mock };

  beforeEach(async () => {
    settingsRepo = {
      findOne: jest.fn(),
      // Clone on create so later `Object.assign(settings, dto)` mutation in the
      // service doesn't retroactively corrupt the args recorded by this mock.
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    repoService = { findOneForUser: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(RepoSettings), useValue: settingsRepo },
        { provide: RepositoriesService, useValue: repoService },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  // ── getSettings — user-scoping via RepositoriesService ──────────────────

  describe('getSettings', () => {
    it('delegates ownership check to RepositoriesService.findOneForUser', async () => {
      repoService.findOneForUser.mockResolvedValue(mockRepoRow());
      settingsRepo.findOne.mockResolvedValue(mockSettingsRow());

      await service.getSettings('user-a', 'repo-1');

      expect(repoService.findOneForUser).toHaveBeenCalledWith('user-a', 'repo-1');
    });

    it('propagates NotFoundException when the repo does not belong to the user', async () => {
      repoService.findOneForUser.mockRejectedValue(new NotFoundException('Repository not found'));

      await expect(service.getSettings('user-b', 'repo-1')).rejects.toThrow(NotFoundException);
      expect(settingsRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns existing settings when a row already exists', async () => {
      repoService.findOneForUser.mockResolvedValue(mockRepoRow());
      const existing = mockSettingsRow({ id: 'existing-settings' });
      settingsRepo.findOne.mockResolvedValue(existing);

      const result = await service.getSettings('user-a', 'repo-1');

      expect(result).toBe(existing);
      expect(settingsRepo.create).not.toHaveBeenCalled();
    });

    it('creates default settings (seeded from the repo default branch) when none exist yet', async () => {
      repoService.findOneForUser.mockResolvedValue(mockRepoRow({ defaultBranch: 'develop' }));
      settingsRepo.findOne.mockResolvedValue(null);

      await service.getSettings('user-a', 'repo-1');

      expect(settingsRepo.create).toHaveBeenCalledWith({ repoId: 'repo-1', defaultBranch: 'develop' });
      expect(settingsRepo.save).toHaveBeenCalled();
    });

    it('scopes the settings lookup to the given repoId', async () => {
      repoService.findOneForUser.mockResolvedValue(mockRepoRow());
      settingsRepo.findOne.mockResolvedValue(mockSettingsRow());

      await service.getSettings('user-a', 'repo-1');

      expect(settingsRepo.findOne).toHaveBeenCalledWith({ where: { repoId: 'repo-1' } });
    });
  });

  // ── updateSettings — CRUD + user scoping ─────────────────────────────────

  describe('updateSettings', () => {
    it('re-checks ownership through getSettings before writing', async () => {
      repoService.findOneForUser.mockResolvedValue(mockRepoRow());
      settingsRepo.findOne.mockResolvedValue(mockSettingsRow());

      await service.updateSettings('user-a', 'repo-1', { autoAnalyzeOnPush: true });

      expect(repoService.findOneForUser).toHaveBeenCalledWith('user-a', 'repo-1');
    });

    it('denies the update when the requesting user does not own the repo', async () => {
      repoService.findOneForUser.mockRejectedValue(new NotFoundException('Repository not found'));

      await expect(
        service.updateSettings('user-b', 'repo-1', { autoAnalyzeOnPush: true }),
      ).rejects.toThrow(NotFoundException);
      expect(settingsRepo.save).not.toHaveBeenCalled();
    });

    it('merges the dto onto the existing settings row and saves it', async () => {
      repoService.findOneForUser.mockResolvedValue(mockRepoRow());
      const existing = mockSettingsRow({ autoAnalyzeOnPush: false, aiOfflineMode: false });
      settingsRepo.findOne.mockResolvedValue(existing);

      const result = await service.updateSettings('user-a', 'repo-1', {
        autoAnalyzeOnPush: true,
        aiOfflineMode: true,
      });

      expect(settingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ autoAnalyzeOnPush: true, aiOfflineMode: true }),
      );
      expect(result).toMatchObject({ autoAnalyzeOnPush: true, aiOfflineMode: true });
    });

    it('creates settings first (seeded defaults) then applies the dto when none existed yet', async () => {
      repoService.findOneForUser.mockResolvedValue(mockRepoRow({ defaultBranch: 'main' }));
      settingsRepo.findOne.mockResolvedValue(null);

      await service.updateSettings('user-a', 'repo-1', { defaultBranch: 'release' });

      expect(settingsRepo.create).toHaveBeenCalledWith({ repoId: 'repo-1', defaultBranch: 'main' });
      // save is called twice: once to persist the seeded row, once with the dto merged in
      expect(settingsRepo.save).toHaveBeenCalledTimes(2);
      const finalSaveArg = settingsRepo.save.mock.calls[1][0];
      expect(finalSaveArg.defaultBranch).toBe('release');
    });
  });
});
