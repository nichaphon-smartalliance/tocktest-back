import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const url = process.env.FRONTEND_URL || 'http://localhost:3012'
  app.enableCors({
    origin: url,
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
  console.log(`🚀 TockTest Backend running on ${url}`);
  console.log(`🚀 TockTest Backend db on '${process.env.DB_HOST}:${process.env.DB_PORT}:'${process.env.DB_NAME}'`);
  console.log(`🚀 TockTest Backend password on '${process.env.DB_PASSWORD}'`);
}

bootstrap();
