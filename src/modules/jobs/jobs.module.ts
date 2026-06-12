import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackgroundJob } from './entities/background-job.entity';
import { JobsService } from './jobs.service';
import { JobRunnerService } from './job-runner.service';
import { JobHandlersService } from './job-handlers.service';
import { JobsController } from './jobs.controller';
import { GithubAppModule } from '../github-app/github-app.module';
import { AiModule } from '../ai/ai.module';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';
import { Repository } from '../repositories/entities/repository.entity';
import { CommitAnalysis } from '../analysis/entities/commit-analysis.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BackgroundJob, Repository, CommitAnalysis]),
    forwardRef(() => GithubAppModule),
    AiModule,
    GithubTokensModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, JobRunnerService, JobHandlersService],
  exports: [JobsService],
})
export class JobsModule {}
