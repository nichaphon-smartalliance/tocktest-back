import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const dataSource = app.get(DataSource);
  await ensureGithubTokenExpiresAt(dataSource);
  await ensureBackgroundJobsTable(dataSource);
  await ensureGithubOAuthAppSchema(dataSource);
  await ensureGithubLoginSchema(dataSource);
  await ensureRepositoryInstallationSchema(dataSource);
  await ensureWebhookEventErrorColumn(dataSource);
  await ensureTestRunsTable(dataSource);
  await ensureVisualRegressionTables(dataSource);

  app.enableCors({
    origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL : true,
    credentials: true,
  });

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
  // ThrottlerGuard requires the module to be configured via APP_GUARD in AppModule if needed globally
  // But for now the ThrottlerModule provides per-route opt-in via @Throttle decorators

  const port = process.env.PORT || 4004;
  await app.listen(port);
  console.log(`🚀 TockTest Backend running on http://localhost:${port}`);
}

async function ensureGithubTokenExpiresAt(dataSource: DataSource) {
  try {
    const result = await dataSource.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'github_tokens' AND column_name = 'expires_at'",
    );
    if (!Array.isArray(result) || result.length === 0) {
      console.log('Adding missing expires_at column to github_tokens table');
      await dataSource.query('ALTER TABLE github_tokens ADD COLUMN expires_at timestamptz');
    }
  } catch (error) {
    console.warn('Could not verify github_tokens schema:', error?.message ?? error);
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

    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS github_webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        installation_id BIGINT,
        event VARCHAR(100) NOT NULL,
        action VARCHAR(100),
        repo_full_name VARCHAR(255),
        delivery_id VARCHAR(100),
        status VARCHAR(20) NOT NULL DEFAULT 'received',
        payload JSONB,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await dataSource.query(
      'CREATE INDEX IF NOT EXISTS idx_github_webhook_events_repo ON github_webhook_events(repo_full_name)',
    );
  } catch (error) {
    console.warn('Could not verify GitHub OAuth/App schema:', error?.message ?? error);
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
  } catch (error) {
    console.warn('Could not ensure background_jobs table:', (error as Error)?.message ?? error);
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
  } catch (error) {
    console.warn('Could not ensure GitHub login schema:', (error as Error)?.message ?? error);
  }
}

async function ensureRepositoryInstallationSchema(dataSource: DataSource) {
  try {
    await dataSource.query('ALTER TABLE repositories ADD COLUMN IF NOT EXISTS installation_id BIGINT');
    await dataSource.query(
      'CREATE INDEX IF NOT EXISTS idx_repositories_installation_id ON repositories(installation_id)',
    );
  } catch (error) {
    console.warn('Could not ensure repository installation schema:', (error as Error)?.message ?? error);
  }
}

async function ensureWebhookEventErrorColumn(dataSource: DataSource) {
  try {
    await dataSource.query('ALTER TABLE github_webhook_events ADD COLUMN IF NOT EXISTS error_message TEXT');
  } catch (error) {
    console.warn('Could not ensure webhook event error column:', (error as Error)?.message ?? error);
  }
}

async function ensureTestRunsTable(dataSource: DataSource) {
  try {
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS test_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        repo_id UUID NOT NULL,
        user_id UUID NOT NULL,
        framework VARCHAR(50) NOT NULL DEFAULT 'playwright',
        file_content TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
        output TEXT,
        exit_code INT,
        duration_ms INT,
        error_message TEXT,
        test_results JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_test_runs_repo_user ON test_runs(repo_id, user_id);
    `);
  } catch (error) {
    console.warn('Could not ensure test_runs table:', (error as Error)?.message ?? error);
  }
}

async function ensureVisualRegressionTables(dataSource: DataSource) {
  try {
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS visual_baselines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        repo_id UUID NOT NULL,
        user_id UUID NOT NULL,
        name VARCHAR(500) NOT NULL,
        url VARCHAR(2000) NOT NULL,
        viewport VARCHAR(50) NOT NULL DEFAULT '1280x720',
        screenshot_data TEXT NOT NULL,
        width INT,
        height INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_visual_baselines_repo ON visual_baselines(repo_id, user_id);

      CREATE TABLE IF NOT EXISTS visual_comparisons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        baseline_id UUID NOT NULL,
        repo_id UUID NOT NULL,
        user_id UUID NOT NULL,
        screenshot_data TEXT NOT NULL,
        diff_data TEXT,
        diff_score FLOAT,
        diff_pixels INT,
        total_pixels INT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        threshold FLOAT NOT NULL DEFAULT 0.01,
        ai_analysis TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_visual_comparisons_baseline ON visual_comparisons(baseline_id);
    `);
  } catch (error) {
    console.warn('Could not ensure visual regression tables:', (error as Error)?.message ?? error);
  }
}

bootstrap();
