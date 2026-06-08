import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommitAnalysis } from './entities/commit-analysis.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AiModule } from '../ai/ai.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommitAnalysis]),
    AiModule,
    RepositoriesModule,
    GithubTokensModule,
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
})
export class AnalysisModule {}
