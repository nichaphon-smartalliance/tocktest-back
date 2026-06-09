import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const dataSource = app.get(DataSource);
  await ensureGithubTokenExpiresAt(dataSource);

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

bootstrap();
