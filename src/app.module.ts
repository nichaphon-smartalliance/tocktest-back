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
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { GithubAppModule } from './modules/github-app/github-app.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USERNAME', 'postgres'),
        password: config.get('DB_PASSWORD', 'postgres'),
        database: config.get('DB_NAME', 'tocktest_db'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false, // Back to false after column is created
        logging: config.get('NODE_ENV') === 'development',
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
    DashboardModule,
    GithubAppModule,
  ],
})
export class AppModule {}
