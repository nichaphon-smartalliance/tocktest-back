import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubAppController } from './github-app.controller';
import { GithubAppService } from './github-app.service';
import { GithubInstallation } from './entities/github-installation.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { Repository } from '../repositories/entities/repository.entity';
import { CommitAnalysis } from '../analysis/entities/commit-analysis.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GithubInstallation, WebhookEvent, Repository, CommitAnalysis])],
  controllers: [GithubAppController],
  providers: [GithubAppService],
  exports: [GithubAppService],
})
export class GithubAppModule {}
