import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, NextFunction, Request, Response, urlencoded } from 'express';
import { randomUUID } from 'crypto';
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
  // Schema is managed by TypeORM migrations (src/database/migrations), applied
  // automatically via `migrationsRun: true` in app.module.ts before this point.

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

bootstrap();
