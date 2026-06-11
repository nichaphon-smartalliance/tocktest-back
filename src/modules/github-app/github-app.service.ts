import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

type GithubWebhookHeaders = {
  event?: string;
  deliveryId?: string;
  signature256?: string;
};

@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);

  constructor(private readonly config: ConfigService) {}

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

  handleWebhook(headers: GithubWebhookHeaders, rawBody: Buffer | string | undefined, body: any) {
    const setup = this.getSetupStatus();
    const event = headers.event || 'unknown';
    const action = body?.action ?? null;
    const deliveryId = headers.deliveryId || null;

    if (setup.webhookSecretConfigured) {
      this.verifySignature(rawBody, headers.signature256);
    }

    const result = this.summarizeEvent(event, body);

    this.logger.log(
      `GitHub webhook received: event=${event} action=${action ?? '-'} delivery=${deliveryId ?? '-'}`,
    );

    return {
      received: true,
      event,
      action,
      deliveryId,
      processedAt: new Date().toISOString(),
      result,
    };
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

  private summarizeEvent(event: string, body: any) {
    if (event === 'ping') {
      return {
        message: 'GitHub webhook handshake received.',
        hookId: body?.hook_id ?? null,
      };
    }

    if (event === 'pull_request') {
      return {
        message: 'Pull request event accepted for future QA automation.',
        repository: body?.repository?.full_name ?? null,
        pullRequestNumber: body?.number ?? null,
        headSha: body?.pull_request?.head?.sha ?? null,
        baseBranch: body?.pull_request?.base?.ref ?? null,
      };
    }

    if (event === 'push') {
      return {
        message: 'Push event accepted for future commit analysis and test generation.',
        repository: body?.repository?.full_name ?? null,
        ref: body?.ref ?? null,
        before: body?.before ?? null,
        after: body?.after ?? null,
      };
    }

    return {
      message: 'Webhook received but no automation handler is wired for this event yet.',
      repository: body?.repository?.full_name ?? null,
    };
  }
}
