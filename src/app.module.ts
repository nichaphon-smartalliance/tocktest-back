import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { GithubTokensModule } from './modules/github-tokens/github-tokens.module';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { TestCasesModule } from './modules/test-cases/test-cases.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { DocsModule } from './modules/docs/docs.module';
import { AiModule } from './modules/ai/ai.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
        username: process.env.DB_USERNAME || 'postgressss',
        password: process.env.DB_PASSWORD || 'smart2026#',
        database: process.env.DB_NAME || 'tocktest_db',
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        logging: process.env.NODE_ENV === 'development',
      }),
    }),
    AuthModule,
    UsersModule,
    GithubTokensModule,
    RepositoriesModule,
    TestCasesModule,
    AnalysisModule,
    DocsModule,
    AiModule,
    SettingsModule,
  ],
})
export class AppModule {}
