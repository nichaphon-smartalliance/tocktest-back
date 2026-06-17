import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { GithubInstallation } from './entities/github-installation.entity';
import { Repository } from '../repositories/entities/repository.entity';

@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GithubInstallation)
    private readonly installationRepo: TypeOrmRepo<GithubInstallation>,
    @InjectRepository(Repository)
    private readonly repoRepo: TypeOrmRepo<Repository>,
  ) {}

  getSetupStatus() {
    const appIdConfigured = !!this.config.get<string>('GITHUB_APP_ID');
    const appName = this.config.get<string>('GITHUB_APP_NAME') || null;
    const privateKeyConfigured = !!this.config.get<string>('GITHUB_APP_PRIVATE_KEY');
    const installUrl =
      this.config.get<string>('GITHUB_APP_INSTALL_URL') ||
      (appName ? `https://github.com/apps/${appName}/installations/new` : null);

    return {
      configured: appIdConfigured && privateKeyConfigured,
      appName,
      installUrl,
      appIdConfigured,
      privateKeyConfigured,
    };
  }

  // --- Installation flow -------------------------------------------------

  getInstallUrl(userId: string): string {
    const setup = this.getSetupStatus();
    if (!setup.installUrl) {
      throw new BadRequestException('GitHub App ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์');
    }

    const state = jwt.sign({ userId, purpose: 'github-app-install' }, this.config.get<string>('JWT_SECRET') as string, {
      expiresIn: '15m',
    });

    const separator = setup.installUrl.includes('?') ? '&' : '?';
    return `${setup.installUrl}${separator}state=${encodeURIComponent(state)}`;
  }

  async getInstallationsForUser(userId: string) {
    return this.installationRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async getInstallationRepositories(userId: string, installationId: string) {
    const installation = await this.installationRepo.findOne({ where: { userId, installationId } });
    if (!installation) {
      throw new BadRequestException('ไม่พบ GitHub App installation นี้สำหรับผู้ใช้นี้');
    }

    const token = await this.getInstallationToken(installationId);
    const res = await axios.get('https://api.github.com/installation/repositories', {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
      params: { per_page: 100 },
    });

    const githubRepos: any[] = res.data?.repositories ?? [];
    const tracked = await this.repoRepo.find({ where: { installationId } });
    const trackedByFullName = new Map(tracked.map((r) => [r.fullName, r]));

    return githubRepos.map((repo) => ({
      githubRepoId: repo.id,
      fullName: repo.full_name,
      name: repo.name,
      private: repo.private,
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch,
      tracked: trackedByFullName.has(repo.full_name),
      repositoryId: trackedByFullName.get(repo.full_name)?.id ?? null,
    }));
  }

  async importInstallationRepository(userId: string, installationId: string, fullName: string) {
    const installation = await this.installationRepo.findOne({ where: { userId, installationId } });
    if (!installation) {
      throw new BadRequestException('ไม่พบ GitHub App installation นี้สำหรับผู้ใช้นี้');
    }

    const token = await this.getInstallationToken(installationId);
    const res = await axios.get(`https://api.github.com/repos/${fullName}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    });
    const gr = res.data;

    await this.repoRepo.upsert(
      {
        userId,
        installationId,
        githubRepoId: gr.id,
        fullName: gr.full_name,
        name: gr.name,
        description: gr.description,
        defaultBranch: gr.default_branch,
        isPrivate: gr.private,
        htmlUrl: gr.html_url,
        cloneUrl: gr.clone_url,
        ownerLogin: gr.owner?.login,
        lastSyncedAt: new Date(),
      },
      { conflictPaths: ['userId', 'githubRepoId'] },
    );

    return { imported: true, fullName: gr.full_name };
  }

  async handleInstallationCallback(
    installationId: string | undefined,
    setupAction: string | undefined,
    state: string | undefined,
  ) {
    let userId: string | null = null;

    if (state) {
      try {
        const payload = jwt.verify(state, this.config.get<string>('JWT_SECRET') as string) as unknown as {
          userId: string;
          purpose: string;
        };
        if (payload.purpose === 'github-app-install') userId = payload.userId;
      } catch {
        this.logger.warn('Received GitHub App installation callback with invalid/expired state');
      }
    }

    if (userId && installationId && setupAction !== 'request') {
      let info: any = null;
      try {
        info = await this.fetchInstallationInfo(installationId);
      } catch (err) {
        this.logger.warn(`Could not fetch installation info for ${installationId}: ${err?.message ?? err}`);
      }

      await this.installationRepo.upsert(
        {
          userId,
          installationId,
          accountLogin: info?.account?.login ?? null,
          accountType: info?.account?.type ?? null,
          repositorySelection: info?.repository_selection ?? null,
        },
        { conflictPaths: ['installationId'] },
      );
    }

    return { userId, installationId: installationId ?? null, setupAction: setupAction ?? null };
  }

  // --- GitHub App auth & writeback ---------------------------------------

  private generateAppJwt(): string {
    const appId = this.config.get<string>('GITHUB_APP_ID');
    const privateKey = this.config.get<string>('GITHUB_APP_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    if (!appId || !privateKey) {
      throw new BadRequestException('GitHub App ไม่ได้ตั้งค่าบนเซิร์ฟเวอร์');
    }

    const now = Math.floor(Date.now() / 1000);
    return jwt.sign({ iat: now - 60, exp: now + 540, iss: appId }, privateKey, { algorithm: 'RS256' });
  }

  private async fetchInstallationInfo(installationId: string) {
    const appJwt = this.generateAppJwt();
    const res = await axios.get(`https://api.github.com/app/installations/${installationId}`, {
      headers: { Authorization: `Bearer ${appJwt}`, Accept: 'application/vnd.github+json' },
    });
    return res.data;
  }

  async getInstallationToken(installationId: string): Promise<string> {
    const appJwt = this.generateAppJwt();
    const res = await axios.post(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {},
      { headers: { Authorization: `Bearer ${appJwt}`, Accept: 'application/vnd.github+json' } },
    );
    return res.data.token;
  }

  async postIssueComment(installationId: string, repoFullName: string, issueNumber: number, body: string) {
    const token = await this.getInstallationToken(installationId);
    await axios.post(
      `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`,
      { body },
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } },
    );
  }

  async postCommitStatus(
    installationId: string,
    repoFullName: string,
    sha: string,
    state: 'pending' | 'success' | 'failure' | 'error',
    description: string,
    context = 'tocktest/qa',
  ) {
    const token = await this.getInstallationToken(installationId);
    await axios.post(
      `https://api.github.com/repos/${repoFullName}/statuses/${sha}`,
      { state, description, context },
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } },
    );
  }
}
