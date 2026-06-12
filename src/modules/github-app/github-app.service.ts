import { Inject, Injectable, Logger, UnauthorizedException, BadRequestException, forwardRef } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { GithubInstallation } from './entities/github-installation.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { Repository } from '../repositories/entities/repository.entity';
import { CommitAnalysis } from '../analysis/entities/commit-analysis.entity';

type GithubWebhookHeaders = {
  event?: string;
  deliveryId?: string;
  signature256?: string;
};

@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GithubInstallation)
    private readonly installationRepo: TypeOrmRepo<GithubInstallation>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepo: TypeOrmRepo<WebhookEvent>,
    @InjectRepository(Repository)
    private readonly repoRepo: TypeOrmRepo<Repository>,
    @InjectRepository(CommitAnalysis)
    private readonly commitAnalysisRepo: TypeOrmRepo<CommitAnalysis>,
    @Inject(forwardRef(() => JobsService)) private readonly jobsService: JobsService,
  ) {}

  getSetupStatus() {
    const appIdConfigured = !!this.config.get<string>('GITHUB_APP_ID');
    const appName = this.config.get<string>('GITHUB_APP_NAME') || null;
    const privateKeyConfigured = !!this.config.get<string>('GITHUB_APP_PRIVATE_KEY');
    const webhookSecretConfigured = !!this.config.get<string>('GITHUB_WEBHOOK_SECRET');
    const installUrl =
      this.config.get<string>('GITHUB_APP_INSTALL_URL') ||
      (appName ? `https://github.com/apps/${appName}/installations/new` : null);

    return {
      configured: appIdConfigured && privateKeyConfigured && webhookSecretConfigured,
      appName,
      installUrl,
      appIdConfigured,
      privateKeyConfigured,
      webhookSecretConfigured,
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

  // --- Webhook intake & processing ---------------------------------------

  async handleWebhook(headers: GithubWebhookHeaders, rawBody: Buffer | string | undefined, body: any) {
    const setup = this.getSetupStatus();
    const event = headers.event || 'unknown';
    const action = body?.action ?? null;
    const deliveryId = headers.deliveryId || null;
    const installationId = body?.installation?.id ? String(body.installation.id) : null;
    const repoFullName = body?.repository?.full_name ?? null;

    if (setup.webhookSecretConfigured) {
      this.verifySignature(rawBody, headers.signature256);
    }

    if (deliveryId) {
      const dup = await this.webhookEventRepo.findOne({ where: { deliveryId } });
      if (dup) {
        return {
          received: true,
          event,
          action,
          deliveryId,
          duplicate: true,
          processedAt: dup.processedAt?.toISOString() ?? null,
        };
      }
    }

    const webhookEvent = this.webhookEventRepo.create({
      installationId,
      event,
      action,
      repoFullName,
      deliveryId,
      payload: body,
      status: 'received',
    });
    await this.webhookEventRepo.save(webhookEvent);

    let result: Record<string, unknown>;
    try {
      result = await this.processEvent(event, action, body, installationId);
      webhookEvent.status = 'processed';
    } catch (err) {
      this.logger.error(`Failed to process GitHub webhook (${event}): ${err?.message ?? err}`);
      result = { message: 'Webhook received but processing failed.', error: err?.message ?? String(err) };
      webhookEvent.status = 'failed';
    }
    webhookEvent.processedAt = new Date();
    await this.webhookEventRepo.save(webhookEvent);

    this.logger.log(
      `GitHub webhook received: event=${event} action=${action ?? '-'} delivery=${deliveryId ?? '-'} status=${webhookEvent.status}`,
    );

    return {
      received: true,
      event,
      action,
      deliveryId,
      processedAt: webhookEvent.processedAt.toISOString(),
      result,
    };
  }

  private async processEvent(
    event: string,
    action: string | null,
    body: any,
    installationId: string | null,
  ): Promise<Record<string, unknown>> {
    switch (event) {
      case 'ping':
        return {
          message: 'GitHub webhook handshake received.',
          hookId: body?.hook_id ?? null,
        };

      case 'installation':
      case 'installation_repositories':
        return this.handleInstallationEvent(action, body);

      case 'push':
        return this.handlePushEvent(body);

      case 'pull_request':
        return this.handlePullRequestEvent(action, body, installationId);

      default:
        return {
          message: 'Webhook received but no automation handler is wired for this event yet.',
          repository: body?.repository?.full_name ?? null,
        };
    }
  }

  private async handleInstallationEvent(action: string | null, body: any): Promise<Record<string, unknown>> {
    const installationId = body?.installation?.id ? String(body.installation.id) : null;
    if (!installationId) {
      return { message: 'Installation event missing installation id, ignored.' };
    }

    if (action === 'deleted') {
      await this.installationRepo.delete({ installationId });
      return { message: 'GitHub App installation removed.', installationId };
    }

    if (action === 'suspend') {
      await this.installationRepo.update({ installationId }, { suspendedAt: new Date() });
      return { message: 'GitHub App installation suspended.', installationId };
    }

    if (action === 'unsuspend') {
      await this.installationRepo.update({ installationId }, { suspendedAt: null });
      return { message: 'GitHub App installation unsuspended.', installationId };
    }

    await this.installationRepo.update(
      { installationId },
      {
        accountLogin: body?.installation?.account?.login ?? null,
        accountType: body?.installation?.account?.type ?? null,
        repositorySelection: body?.installation?.repository_selection ?? null,
      },
    );

    return { message: `Installation '${action ?? 'updated'}' event processed.`, installationId };
  }

  private async handlePushEvent(body: any): Promise<Record<string, unknown>> {
    const fullName = body?.repository?.full_name ?? null;
    const after = body?.after ?? null;
    const ref = body?.ref ?? null;

    if (!fullName || !after || /^0+$/.test(after)) {
      return { message: 'Push event ignored (branch deleted or missing commit info).', repository: fullName, ref };
    }

    const repo = await this.repoRepo.findOne({ where: { fullName } });
    if (!repo) {
      return {
        message: 'Push event accepted, but repository is not tracked in TockTest yet.',
        repository: fullName,
        ref,
      };
    }

    const headCommit = body?.head_commit ?? null;
    await this.commitAnalysisRepo.upsert(
      {
        repoId: repo.id,
        commitSha: after,
        commitMessage: headCommit?.message ?? null,
        authorName: headCommit?.author?.name ?? null,
        authorEmail: headCommit?.author?.email ?? null,
        committedAt: headCommit?.timestamp ? new Date(headCommit.timestamp) : null,
        rawData: { source: 'webhook', ref, pusher: body?.pusher ?? null },
      },
      { conflictPaths: ['repoId', 'commitSha'] },
    );

    const installationId = body?.installation?.id ? String(body.installation.id) : null;
    await this.jobsService.enqueue(
      'analyze_commit',
      { repoId: repo.id, commitSha: after, installationId },
      `analyze:${repo.id}:${after}`,
    );

    return {
      message: 'Push event queued for background commit analysis.',
      repository: fullName,
      ref,
      commitSha: after,
      queued: true,
    };
  }

  private async handlePullRequestEvent(
    action: string | null,
    body: any,
    installationId: string | null,
  ): Promise<Record<string, unknown>> {
    const fullName = body?.repository?.full_name ?? null;
    const prNumber = body?.number ?? null;
    const headSha = body?.pull_request?.head?.sha ?? null;
    const baseBranch = body?.pull_request?.base?.ref ?? null;

    const trackedActions = ['opened', 'reopened', 'synchronize'];
    let queued = false;

    if (installationId && fullName && prNumber && headSha && trackedActions.includes(action ?? '')) {
      await this.jobsService.enqueue(
        'pr_review',
        { installationId, repoFullName: fullName, prNumber, headSha },
        `pr:${fullName}:${prNumber}:${headSha}`,
      );
      queued = true;
    }

    return {
      message: queued
        ? 'Pull request queued for background AI review and GitHub writeback.'
        : 'Pull request event recorded (no automation for this action).',
      repository: fullName,
      pullRequestNumber: prNumber,
      headSha,
      baseBranch,
      queued,
    };
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

  private verifySignature(rawBody: Buffer | string | undefined, signature256?: string) {
    const secret = this.config.get<string>('GITHUB_WEBHOOK_SECRET');
    if (!secret) return;
    if (!rawBody || !signature256) {
      throw new UnauthorizedException('Missing GitHub webhook signature');
    }

    const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expected = `sha256=${createHmac('sha256', secret).update(payloadBuffer).digest('hex')}`;
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(signature256);

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
  }
}
