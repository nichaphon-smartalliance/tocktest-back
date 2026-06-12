import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const dataSource = app.get(DataSource);
  await ensureGithubTokenExpiresAt(dataSource);
  await ensureGithubOAuthAppSchema(dataSource);

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

bootstrap();
