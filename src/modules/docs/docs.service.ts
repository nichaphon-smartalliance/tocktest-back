import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo, In } from 'typeorm';
import axios from 'axios';
import { ProjectDoc } from './entities/project-doc.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { RepoSettings } from '../settings/entities/repo-settings.entity';
import { UsersService } from '../users/users.service';

type DocSyncStatus = 'idle' | 'queued' | 'running' | 'success' | 'error';

interface SourceTreeItem {
  path: string;
  sha: string;
  type: string;
  size?: number;
}

interface SourceCacheEntry {
  path: string;
  sha: string;
  section: string;
  title: string;
  summary: string[];
}

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
      await this.settingsRepo.update({ repoId: id }, { docsDeletedByEmail: null, docsDeletedAt: null } as any);
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
    await this.repoService.findOneForUser(userId, repoId);
    await this.docRepo.delete({ repoId });
    await this.updateSettings(repoId, {
      docsSyncStatus: 'idle',
      docsSyncMessage: null,
      docsLastGeneratedAt: null,
      docsLastCommitSha: null,
      docsLastSourceSha: null,
      docsSourceCache: null,
    });
  }

  async getStatus(userId: string, repoId: string): Promise<DocStatusResponse> {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const settings = await this.getOrCreateSettings(repoId, repo.defaultBranch);

    let isStale = false;
    try {
      const token = await this.githubTokensService.getDecryptedToken(userId);
      if (token && settings.docsLastCommitSha) {
        const head = await this.fetchBranchHead(repo.fullName, token, settings.defaultBranch || repo.defaultBranch);
        isStale = head.commitSha !== settings.docsLastCommitSha;
      }
    } catch (error: any) {
      this.logger.warn(`Could not compute docs staleness for ${repo.fullName}: ${error.message}`);
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

    void this.generateInBackground(userId, repoId, forceFull).catch((error) => {
      this.logger.error(`Docs generation failed for ${repo.fullName}: ${error.message}`);
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
      const head = await this.fetchBranchHead(repo.fullName, token, branch);
      const tree = await this.fetchRepoTree(repo.fullName, token, head.treeSha);
      const relevantFiles = tree.filter((item) => this.isRelevantSourceFile(item.path, item.type));

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
        const compared = await this.fetchChangedPaths(repo.fullName, token, settings.docsLastCommitSha, head.commitSha);
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
        const content = await this.fetchFileContent(repo.fullName, token, item.path, head.commitSha);
        nextCache[item.path] = this.summarizeSourceFile(item.path, item.sha, content);
      }

      const markdown = this.renderDocMarkdown({
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
    } catch (error: any) {
      await this.markStatus(repoId, 'error', this.describeGenerationError(error));
      throw error;
    }
  }

  private async getLatestDocVersion(repoId: string): Promise<number> {
    const latest = await this.docRepo.findOne({
      where: { repoId },
      select: ['version'],
      order: { version: 'DESC' },
    });
    return latest?.version ?? 0;
  }

  private async clearDeletionInfoAcrossSharedRepos(userId: string, repoId: string): Promise<void> {
    const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);
    for (const id of sharedIds) {
      await this.settingsRepo.update({ repoId: id }, { docsDeletedByEmail: null, docsDeletedAt: null } as any);
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
    await this.settingsRepo.update({ repoId }, patch as any);
  }

  private async markStatus(repoId: string, status: DocSyncStatus, message: string | null, extra: Partial<RepoSettings> = {}) {
    await this.updateSettings(repoId, {
      docsSyncStatus: status,
      docsSyncMessage: message,
      ...extra,
    });
  }

  private describeGenerationError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const apiMessage =
        typeof error.response?.data?.message === 'string'
          ? error.response.data.message
          : Array.isArray(error.response?.data?.message)
            ? error.response?.data?.message.join(', ')
            : null;

      if (status === 401) {
        return 'GitHub token is invalid or expired. Reconnect GitHub and try generating docs again.';
      }

      if (status === 403) {
        return 'GitHub denied access to this repository or rate-limited the request. Check token scopes and repository access.';
      }

      if (status === 404) {
        return 'Repository or branch was not found on GitHub. Check repository access and default branch settings.';
      }

      if (apiMessage) {
        return `GitHub API error: ${apiMessage}`;
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'Documentation generation failed.';
  }

  private async fetchBranchHead(fullName: string, token: string, branch: string) {
    const response = await axios.get(`https://api.github.com/repos/${fullName}/branches/${encodeURIComponent(branch)}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
      timeout: 10000,
    });

    return {
      commitSha: response.data?.commit?.sha as string,
      treeSha: response.data?.commit?.commit?.tree?.sha as string,
    };
  }

  private async fetchRepoTree(fullName: string, token: string, treeSha: string): Promise<SourceTreeItem[]> {
    const response = await axios.get(`https://api.github.com/repos/${fullName}/git/trees/${treeSha}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
      params: { recursive: 1 },
      timeout: 15000,
    });
    return Array.isArray(response.data?.tree) ? response.data.tree : [];
  }

  private async fetchChangedPaths(fullName: string, token: string, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const response = await axios.get(`https://api.github.com/repos/${fullName}/compare/${base}...${head}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
      timeout: 15000,
    });
    const files = Array.isArray(response.data?.files) ? response.data.files : [];
    return files.map((file: any) => String(file.filename ?? '')).filter(Boolean);
  }

  private async fetchFileContent(fullName: string, token: string, filePath: string, ref: string): Promise<string> {
    const response = await axios.get(`https://api.github.com/repos/${fullName}/contents/${filePath}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
      params: { ref },
      timeout: 15000,
    });
    const encoded = response.data?.content;
    if (typeof encoded !== 'string') return '';
    return Buffer.from(encoded, 'base64').toString('utf-8');
  }

  private isRelevantSourceFile(filePath: string, itemType: string): boolean {
    if (itemType !== 'blob') return false;
    if (filePath.startsWith('node_modules/') || filePath.startsWith('.next/') || filePath.startsWith('dist/')) {
      return false;
    }

    const lcPath = filePath.toLowerCase();
    if (lcPath === 'package.json' || lcPath === 'readme.md') return true;
    if (!lcPath.startsWith('src/')) return false;

    return /\.(ts|tsx|js|jsx|json|md)$/.test(lcPath);
  }

  private summarizeSourceFile(filePath: string, sha: string, content: string): SourceCacheEntry {
    const title = this.extractTitle(filePath, content);
    const section = this.resolveSection(filePath);
    const summary = this.extractSummaryLines(filePath, content);

    return {
      path: filePath,
      sha,
      section,
      title,
      summary,
    };
  }

  private extractTitle(filePath: string, content: string): string {
    const classMatch = content.match(/export\s+class\s+([A-Za-z0-9_]+)/);
    if (classMatch) return classMatch[1];
    const fnMatch = content.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/) ?? content.match(/export\s+function\s+([A-Za-z0-9_]+)/);
    if (fnMatch) return fnMatch[1];
    return filePath.split('/').pop() ?? filePath;
  }

  private resolveSection(filePath: string): string {
    const lcPath = filePath.toLowerCase();
    if (lcPath.includes('/controller')) return 'API Controllers';
    if (lcPath.includes('/service')) return 'Services';
    if (lcPath.includes('/dto/')) return 'DTOs';
    if (lcPath.includes('/entities/')) return 'Entities and Models';
    if (lcPath.includes('/hooks/')) return 'Frontend Hooks';
    if (lcPath.includes('/components/')) return 'UI Components';
    if (lcPath.includes('/app/')) return 'Routes and Pages';
    if (lcPath.endsWith('package.json')) return 'Runtime and Tooling';
    return 'Other Sources';
  }

  private extractSummaryLines(filePath: string, content: string): string[] {
    const lines: string[] = [];
    const normalized = content.replace(/\r/g, '');

    const routeDecorators = [...normalized.matchAll(/@(Get|Post|Put|Delete|Patch)\(([^)]*)\)[\s\S]*?\n\s*([A-Za-z0-9_]+)\(/g)];
    if (routeDecorators.length > 0) {
      for (const match of routeDecorators.slice(0, 8)) {
        lines.push(`${match[1].toUpperCase()} ${this.cleanRoute(match[2])} -> ${match[3]}()`);
      }
      return lines;
    }

    const propertyMatches = [...normalized.matchAll(/^\s*([A-Za-z0-9_]+)\??:\s*[^;]+;/gm)];
    if (filePath.includes('/dto/') || filePath.includes('/entities/')) {
      if (propertyMatches.length > 0) {
        lines.push(`Fields: ${propertyMatches.slice(0, 10).map((match) => match[1]).join(', ')}`);
      }
      return lines.length > 0 ? lines : ['Structured data definition used by the application.'];
    }

    const methodMatches = [...normalized.matchAll(/^\s*(?:async\s+)?([A-Za-z0-9_]+)\([^)]*\)\s*[{:]/gm)];
    if (methodMatches.length > 0) {
      lines.push(`Methods: ${methodMatches.slice(0, 8).map((match) => `${match[1]}()`).join(', ')}`);
    }

    const importMatches = [...normalized.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)];
    if (filePath.includes('/hooks/') && importMatches.length > 0) {
      lines.push(`Depends on: ${importMatches.slice(0, 5).map((match) => match[1]).join(', ')}`);
    }

    const exportedConst = normalized.match(/export\s+const\s+([A-Za-z0-9_]+)/);
    if (exportedConst) {
      lines.push(`Exports ${exportedConst[1]}.`);
    }

    if (lines.length === 0) {
      const commentLine = normalized
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('import ') && !line.startsWith('export ') && !line.startsWith('//'));
      if (commentLine) lines.push(commentLine.slice(0, 140));
    }

    return lines.length > 0 ? lines : ['Application source file referenced by the generated docs workflow.'];
  }

  private cleanRoute(rawRoute: string): string {
    const trimmed = rawRoute.trim();
    if (!trimmed || trimmed === "''" || trimmed === '""') return '/';
    return trimmed.replace(/^['"`]|['"`]$/g, '') || '/';
  }

  private renderDocMarkdown(input: {
    repoFullName: string;
    branch: string;
    headSha: string;
    generatedAt: Date;
    cache: Record<string, SourceCacheEntry>;
    offlineMode: boolean;
    changedPaths: string[];
  }) {
    const grouped = new Map<string, SourceCacheEntry[]>();
    for (const entry of Object.values(input.cache)) {
      const list = grouped.get(entry.section) ?? [];
      list.push(entry);
      grouped.set(entry.section, list);
    }

    const sectionOrder = [
      'Runtime and Tooling',
      'Routes and Pages',
      'API Controllers',
      'Services',
      'DTOs',
      'Entities and Models',
      'Frontend Hooks',
      'UI Components',
      'Other Sources',
    ];

    const chunks: string[] = [];
    chunks.push(`# ${input.repoFullName} Documentation`);
    chunks.push('');
    chunks.push(`- Branch: \`${input.branch}\``);
    chunks.push(`- Source commit: \`${input.headSha.slice(0, 12)}\``);
    chunks.push(`- Generated at: ${input.generatedAt.toISOString()}`);
    chunks.push(`- Mode: ${input.offlineMode ? 'Offline-safe deterministic generator' : 'Deterministic generator'}`);
    chunks.push(`- Cached source files: ${Object.keys(input.cache).length}`);
    chunks.push('');
    chunks.push('## Change Summary');
    chunks.push('');
    if (input.changedPaths.length === 0) {
      chunks.push('- No relevant source changes were detected since the previous docs build.');
    } else {
      for (const path of input.changedPaths.slice(0, 30)) {
        chunks.push(`- ${path}`);
      }
    }

    for (const section of sectionOrder) {
      const entries = (grouped.get(section) ?? []).sort((a, b) => a.path.localeCompare(b.path));
      if (entries.length === 0) continue;
      chunks.push('');
      chunks.push(`## ${section}`);
      chunks.push('');
      for (const entry of entries) {
        chunks.push(`### ${entry.title}`);
        chunks.push('');
        chunks.push(`- File: \`${entry.path}\``);
        if (entry.summary.length === 0) {
          chunks.push('- Summary unavailable.');
        } else {
          for (const line of entry.summary) {
            chunks.push(`- ${line}`);
          }
        }
        chunks.push('');
      }
    }

    return chunks.join('\n').trim();
  }
}
