import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, NextFunction, Request, Response, urlencoded } from 'express';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { recordAuthFailure } from './common/security/auth-failure-monitor';
import { validateSecrets } from './common/security/validate-secrets';

async function bootstrap() {
  // Fail fast (prod) / warn (dev) on placeholder or weak secrets.
  validateSecrets();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Number of reverse proxies to trust for X-Forwarded-For — this decides the
  // client IP used for rate limiting. It MUST match the real deployment or a
  // client can spoof X-Forwarded-For to forge its source IP and evade per-IP
  // throttling. Set TRUST_PROXY=0 when the app is directly exposed (e.g. local
  // dev), or the exact hop count behind load balancers. Defaults to 1 proxy.
  const trustProxy = process.env.TRUST_PROXY ?? '1';
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true');
  // Don't advertise the framework (info-disclosure hardening).
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  const dataSource = app.get(DataSource);
  await ensureGithubTokenExpiresAt(dataSource);
  await ensureBackgroundJobsTable(dataSource);
  await ensureGithubOAuthAppSchema(dataSource);
  await ensureGithubLoginSchema(dataSource);
  await ensureUserSessionVersionSchema(dataSource);
  await ensureRepositoryInstallationSchema(dataSource);
  await ensureRepoSettingsEnhancements(dataSource);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Enforce HTTPS on any host that has served the API over TLS at least once.
    // Ignored by browsers over plain HTTP, so safe to send in all environments.
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // API only ever returns JSON — lock it down so a response can never be
    // interpreted as an active document.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  app.use(requestContextLogger);

  const corsOrigins = resolveCorsOrigins();
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Rich-text docs may embed base64 images, so allow larger JSON bodies.
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '12mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)));

  const port = process.env.PORT || 4004;
  await app.listen(port);
  console.log(`TockTest Backend running on http://localhost:${port}`);
}

function requestContextLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  const incomingId = req.header('x-request-id');
  const requestId = incomingId && incomingId.length <= 128 ? incomingId : randomUUID();

  res.setHeader('X-Request-ID', requestId);
  res.on('finish', () => {
    const entry = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      event: 'http_request',
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    };
    console.log(JSON.stringify(entry));

    // A09: surface credential-stuffing / brute-force. Rejected auth attempts
    // (401) or throttled auth traffic (429) on the auth routes feed a rolling
    // per-IP counter that emits a `security_alert` log line past a threshold.
    const isAuthRoute = req.path.startsWith('/api/v1/auth/');
    if (isAuthRoute && (res.statusCode === 401 || res.statusCode === 429)) {
      recordAuthFailure(req.ip ?? 'unknown', (alert) => console.log(JSON.stringify(alert)));
    }
  });

  next();
}

function resolveCorsOrigins(): string[] {
  const configured = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FRONTEND_URL must be configured in production');
  }
  return ['http://localhost:4003', 'http://localhost:3012'];
}

async function ensureGithubTokenExpiresAt(dataSource: DataSource) {
  try {
    const tableExists = await dataSource.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'github_tokens'",
    );
    if (!Array.isArray(tableExists) || tableExists.length === 0) return;

    const colExists = await dataSource.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'github_tokens' AND column_name = 'expires_at'",
    );
    if (!Array.isArray(colExists) || colExists.length === 0) {
      console.log('Adding missing expires_at column to github_tokens table');
      await dataSource.query('ALTER TABLE github_tokens ADD COLUMN expires_at timestamptz');
    }
  } catch (error : {message?: string} | any) {
    console.warn('Could not verify github_tokens schema:', error.message ?? error);
  }
}

async function ensureGithubOAuthAppSchema(dataSource: DataSource) {
  try {
    await dataSource.query(
      "ALTER TABLE github_tokens ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'pat'",
    );
    await dataSource.query('ALTER TABLE github_tokens ADD COLUMN IF NOT EXISTS github_login VARCHAR(255)');
    await dataSource.query('ALTER TABLE github_tokens ADD COLUMN IF NOT EXISTS github_user_id BIGINT');

    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS github_installations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        installation_id BIGINT NOT NULL UNIQUE,
        account_login VARCHAR(255),
        account_type VARCHAR(50),
        repository_selection VARCHAR(50),
        suspended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await dataSource.query(
      'CREATE INDEX IF NOT EXISTS idx_github_installations_user_id ON github_installations(user_id)',
    );
  } catch (error : {message?: string} | any) {
    console.warn('Could not verify GitHub OAuth/App schema:', error.message ?? error);
  }
}

async function ensureBackgroundJobsTable(dataSource: DataSource) {
  try {
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS background_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'pending',
        payload jsonb NOT NULL,
        dedupe_key varchar UNIQUE,
        attempts int NOT NULL DEFAULT 0,
        max_attempts int NOT NULL DEFAULT 3,
        last_error text,
        scheduled_at timestamptz NOT NULL DEFAULT NOW(),
        started_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_background_jobs_status_scheduled ON background_jobs (status, scheduled_at);
    `);
  } catch (error : {message?: string} | any) {
    console.warn('Could not ensure background_jobs table:', error.message ?? error);
  }
}

async function ensureGithubLoginSchema(dataSource: DataSource) {
  try {
    await dataSource.query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');
    await dataSource.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id BIGINT');
    await dataSource.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS github_login VARCHAR(255)');
    await dataSource.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'local'");
    await dataSource.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)');
    await dataSource.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL',
    );
  } catch (error : {message?: string} | any) {
    console.warn('Could not ensure GitHub login schema:', error.message ?? error);
  }
}

async function ensureUserSessionVersionSchema(dataSource: DataSource) {
  try {
    await dataSource.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0');
  } catch (error : {message?: string} | any) {
    console.warn('Could not ensure user session version schema:', error.message ?? error);
  }
}

async function ensureRepositoryInstallationSchema(dataSource: DataSource) {
  try {
    await dataSource.query('ALTER TABLE repositories ADD COLUMN IF NOT EXISTS installation_id BIGINT');
    await dataSource.query(
      'CREATE INDEX IF NOT EXISTS idx_repositories_installation_id ON repositories(installation_id)',
    );
  } catch (error : {message?: string} | any) {
    console.warn('Could not ensure repository installation schema:', error.message ?? error);
  }
}

async function ensureRepoSettingsEnhancements(dataSource: DataSource) {
  try {
    await dataSource.query("ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS ai_offline_mode BOOLEAN NOT NULL DEFAULT false");
    await dataSource.query("ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_auto_sync BOOLEAN NOT NULL DEFAULT false");
    await dataSource.query("ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_sync_status VARCHAR(20) NOT NULL DEFAULT 'idle'");
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_sync_message TEXT');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_last_generated_at TIMESTAMPTZ');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_last_commit_sha VARCHAR(64)');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_last_source_sha VARCHAR(64)');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_source_cache JSONB');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_deleted_by_email VARCHAR(255)');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_deleted_at TIMESTAMPTZ');
  } catch (error) {
    console.warn('Could not ensure repo_settings enhancements:', (error as Error)?.message ?? error);
  }
}

bootstrap();
