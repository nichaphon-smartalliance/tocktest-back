import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo, In } from 'typeorm';
import { ProjectDoc } from './entities/project-doc.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { RepoSettings } from '../settings/entities/repo-settings.entity';
import { UsersService } from '../users/users.service';
import { DocsSourceService } from './docs-source.service';
import { SourceCacheEntry, isRelevantSourceFile, renderDocMarkdown, summarizeSourceFile } from './doc-markdown.util';
import { getErrorMessage } from '../../common/utils/error.util';

type DocSyncStatus = 'idle' | 'queued' | 'running' | 'success' | 'error';

export interface DocStatusResponse {
  status: DocSyncStatus;
  message: string | null;
  lastGeneratedAt: Date | null;
  lastCommitSha: string | null;
  lastSourceSha: string | null;
  autoSync: boolean;
  offlineMode: boolean;
  isStale: boolean;
}

export type DocHistoryEntry =
  | { kind: 'version'; id: string; version: number; updatedAt: Date; updatedBy: string | null }
  | { kind: 'deleted'; id: string; email: string; deletedAt: Date };

@Injectable()
export class DocsService {
  private readonly logger = new Logger(DocsService.name);

  constructor(
    @InjectRepository(ProjectDoc)
    private readonly docRepo: TypeOrmRepo<ProjectDoc>,
    @InjectRepository(RepoSettings)
    private readonly settingsRepo: TypeOrmRepo<RepoSettings>,
    private readonly repoService: RepositoriesService,
    private readonly githubTokensService: GithubTokensService,
    private readonly usersService: UsersService,
    private readonly docsSource: DocsSourceService,
  ) {}

  async getLatestDoc(userId: string, repoId: string): Promise<ProjectDoc | null> {
    const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);
    return this.docRepo.findOne({
      where: sharedIds.map((id) => ({ repoId: id })),
      order: { version: 'DESC' },
    });
  }

  async updateDoc(userId: string, repoId: string, content: string, latestVersion?: number): Promise<ProjectDoc> {
    await this.repoService.findOneForUser(userId, repoId);
    const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);

    let newVersion: number;
    if (latestVersion !== undefined) {
      newVersion = latestVersion + 1;
    } else {
      const latest = await this.docRepo.findOne({
        where: sharedIds.map((id) => ({ repoId: id })),
        select: ['version'],
        order: { version: 'DESC' },
      });
      newVersion = (latest?.version ?? 0) + 1;
    }

    const doc = this.docRepo.create({ repoId, content, version: newVersion, updatedBy: userId });
    const saved = await this.docRepo.save(doc);

    for (const id of sharedIds) {
      await this.settingsRepo.update({ repoId: id }, { docsDeletedByEmail: null, docsDeletedAt: null });
    }

    return saved;
  }

  async getVersions(userId: string, repoId: string): Promise<DocHistoryEntry[]> {
    const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);

    const versions = await this.docRepo.find({
      where: sharedIds.map((id) => ({ repoId: id })),
      select: ['id', 'version', 'updatedAt', 'updatedBy'],
      order: { version: 'DESC' },
      take: 20,
    });

    const settings = await this.settingsRepo.findOne({ where: { repoId } });

    const entries: DocHistoryEntry[] = versions.map((v) => ({
      kind: 'version' as const,
      id: v.id,
      version: v.version,
      updatedAt: v.updatedAt,
      updatedBy: v.updatedBy,
    }));

    if (settings?.docsDeletedByEmail && settings.docsDeletedAt) {
      entries.unshift({
        kind: 'deleted' as const,
        id: `del-${settings.docsDeletedAt.getTime()}`,
        email: settings.docsDeletedByEmail,
        deletedAt: settings.docsDeletedAt,
      });
    }

    return entries;
  }

  async deleteDoc(userId: string, repoId: string): Promise<void> {
    const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);
    const user = await this.usersService.findById(userId);
    const email = user?.email ?? userId;
    const now = new Date();

    await this.docRepo.delete({ repoId: In(sharedIds) });

    for (const id of sharedIds) {
      await this.updateSettings(id, {
        docsSyncStatus: 'idle',
        docsSyncMessage: null,
        docsLastGeneratedAt: null,
        docsLastCommitSha: null,
        docsLastSourceSha: null,
        docsSourceCache: null,
        docsDeletedByEmail: email,
        docsDeletedAt: now,
      });
    }
  }

  async getStatus(userId: string, repoId: string): Promise<DocStatusResponse> {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const settings = await this.getOrCreateSettings(repoId, repo.defaultBranch);

    let isStale = false;
    try {
      const token = await this.githubTokensService.getDecryptedToken(userId);
      if (token && settings.docsLastCommitSha) {
        const head = await this.docsSource.fetchBranchHead(repo.fullName, token, settings.defaultBranch || repo.defaultBranch);
        isStale = head.commitSha !== settings.docsLastCommitSha;
      }
    } catch (error: unknown) {
      this.logger.warn(`Could not compute docs staleness for ${repo.fullName}: ${getErrorMessage(error)}`);
    }

    return {
      status: this.normalizeStatus(settings.docsSyncStatus),
      message: settings.docsSyncMessage,
      lastGeneratedAt: settings.docsLastGeneratedAt,
      lastCommitSha: settings.docsLastCommitSha,
      lastSourceSha: settings.docsLastSourceSha,
      autoSync: settings.docsAutoSync,
      offlineMode: settings.aiOfflineMode,
      isStale,
    };
  }

  async generate(userId: string, repoId: string) {
    return this.startGeneration(userId, repoId, true);
  }

  async refresh(userId: string, repoId: string) {
    return this.startGeneration(userId, repoId, false);
  }

  async autoUpdate(userId: string, repoId: string) {
    return this.refresh(userId, repoId);
  }

  private async startGeneration(userId: string, repoId: string, forceFull: boolean) {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const settings = await this.getOrCreateSettings(repoId, repo.defaultBranch);
    const currentStatus = this.normalizeStatus(settings.docsSyncStatus);

    if (currentStatus === 'queued' || currentStatus === 'running') {
      return this.getStatus(userId, repoId);
    }

    await this.updateSettings(repoId, {
      docsSyncStatus: 'queued',
      docsSyncMessage: forceFull ? 'Queued full documentation build.' : 'Queued incremental documentation refresh.',
    });

    void this.generateInBackground(userId, repoId, forceFull).catch((error: unknown) => {
      this.logger.error(`Docs generation failed for ${repo.fullName}: ${getErrorMessage(error)}`);
    });

    return this.getStatus(userId, repoId);
  }

  private async generateInBackground(userId: string, repoId: string, forceFull: boolean): Promise<void> {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const settings = await this.getOrCreateSettings(repoId, repo.defaultBranch);
    const token = await this.githubTokensService.getDecryptedToken(userId);
    if (!token) {
      await this.markStatus(repoId, 'error', 'GitHub token is required to generate docs.');
      throw new NotFoundException('GitHub token not found');
    }

    await this.markStatus(
      repoId,
      'running',
      forceFull ? 'Building docs from repository sources...' : 'Refreshing docs from changed files...',
    );

    try {
      const branch = settings.defaultBranch || repo.defaultBranch || 'main';
      const head = await this.docsSource.fetchBranchHead(repo.fullName, token, branch);
      const tree = await this.docsSource.fetchRepoTree(repo.fullName, token, head.treeSha);
      const relevantFiles = tree.filter((item) => isRelevantSourceFile(item.path, item.type));

      const previousCache = this.readCache(settings.docsSourceCache);
      const nextCache: Record<string, SourceCacheEntry> = {};
      const relevantPathSet = new Set(relevantFiles.map((item) => item.path));
      const changedPaths = new Set<string>();

      for (const [path, entry] of Object.entries(previousCache)) {
        if (relevantPathSet.has(path)) {
          nextCache[path] = entry;
        }
      }

      if (!forceFull && settings.docsLastCommitSha === head.commitSha && settings.docsLastSourceSha === head.treeSha) {
        await this.markStatus(repoId, 'success', 'Docs are already up to date.', {
          docsLastGeneratedAt: settings.docsLastGeneratedAt ?? new Date(),
        });
        await this.clearDeletionInfoAcrossSharedRepos(userId, repoId);
        return;
      }

      const existingPaths = new Set(Object.keys(nextCache));
      for (const item of relevantFiles) {
        if (!existingPaths.has(item.path)) {
          changedPaths.add(item.path);
        }
      }

      if (forceFull || !settings.docsLastCommitSha || Object.keys(nextCache).length === 0) {
        for (const item of relevantFiles) changedPaths.add(item.path);
      } else if (settings.docsLastCommitSha !== head.commitSha) {
        const compared = await this.docsSource.fetchChangedPaths(repo.fullName, token, settings.docsLastCommitSha, head.commitSha);
        for (const filePath of compared) {
          if (relevantPathSet.has(filePath)) changedPaths.add(filePath);
        }
      }

      for (const path of Object.keys(nextCache)) {
        if (!relevantPathSet.has(path)) {
          delete nextCache[path];
        }
      }

      const changedList = relevantFiles.filter((item) => changedPaths.has(item.path));
      for (const item of changedList) {
        const content = await this.docsSource.fetchFileContent(repo.fullName, token, item.path, head.commitSha);
        nextCache[item.path] = summarizeSourceFile(item.path, item.sha, content);
      }

      const markdown = renderDocMarkdown({
        repoFullName: repo.fullName,
        branch,
        headSha: head.commitSha,
        generatedAt: new Date(),
        cache: nextCache,
        offlineMode: settings.aiOfflineMode,
        changedPaths: [...changedPaths].sort(),
      });

      const latest = await this.getLatestDoc(userId, repoId);
      if (!latest || latest.content.trim() !== markdown.trim()) {
        await this.updateDoc(userId, repoId, markdown, latest?.version ?? 0);
      }

      await this.markStatus(
        repoId,
        'success',
        changedPaths.size > 0
          ? `Docs updated from ${changedPaths.size} changed source file(s).`
          : 'Docs regenerated with no structural changes detected.',
        {
          docsLastGeneratedAt: new Date(),
          docsLastCommitSha: head.commitSha,
          docsLastSourceSha: head.treeSha,
          docsSourceCache: nextCache,
        },
      );
      await this.clearDeletionInfoAcrossSharedRepos(userId, repoId);
    } catch (error: unknown) {
      await this.markStatus(repoId, 'error', this.docsSource.describeGenerationError(error));
      throw error;
    }
  }

  private async clearDeletionInfoAcrossSharedRepos(userId: string, repoId: string): Promise<void> {
    const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);
    for (const id of sharedIds) {
      await this.settingsRepo.update({ repoId: id }, { docsDeletedByEmail: null, docsDeletedAt: null });
    }
  }

  private async getOrCreateSettings(repoId: string, defaultBranch: string): Promise<RepoSettings> {
    let settings = await this.settingsRepo.findOne({ where: { repoId } });
    if (!settings) {
      settings = this.settingsRepo.create({ repoId, defaultBranch });
      settings = await this.settingsRepo.save(settings);
    }
    return settings;
  }

  private normalizeStatus(status?: string | null): DocSyncStatus {
    if (status === 'queued' || status === 'running' || status === 'success' || status === 'error') {
      return status;
    }
    return 'idle';
  }

  private readCache(raw: Record<string, unknown> | null): Record<string, SourceCacheEntry> {
    if (!raw || typeof raw !== 'object') return {};
    const entries: Record<string, SourceCacheEntry> = {};
    for (const [path, value] of Object.entries(raw)) {
      const item = value as Partial<SourceCacheEntry>;
      if (!item || typeof item !== 'object') continue;
      entries[path] = {
        path,
        sha: typeof item.sha === 'string' ? item.sha : '',
        section: typeof item.section === 'string' ? item.section : 'Other Sources',
        title: typeof item.title === 'string' ? item.title : path.split('/').pop() ?? path,
        summary: Array.isArray(item.summary) ? item.summary.filter((line): line is string => typeof line === 'string') : [],
      };
    }
    return entries;
  }

  private async updateSettings(repoId: string, patch: Partial<RepoSettings>) {
    // TypeORM's QueryDeepPartialEntity typing rejects a plain Partial<RepoSettings>
    // here because of the jsonb `docsSourceCache` field — this cast is a narrow,
    // known escape hatch for that typing gap, not a stand-in for real typing.
    await this.settingsRepo.update({ repoId }, patch as Parameters<typeof this.settingsRepo.update>[1]);
  }

  private async markStatus(repoId: string, status: DocSyncStatus, message: string | null, extra: Partial<RepoSettings> = {}) {
    await this.updateSettings(repoId, {
      docsSyncStatus: status,
      docsSyncMessage: message,
      ...extra,
    });
  }
}
