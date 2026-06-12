import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubAppController } from './github-app.controller';
import { GithubAppService } from './github-app.service';
import { GithubInstallation } from './entities/github-installation.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { Repository } from '../repositories/entities/repository.entity';
import { CommitAnalysis } from '../analysis/entities/commit-analysis.entity';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([GithubInstallation, WebhookEvent, Repository, CommitAnalysis]), AiModule],
  controllers: [GithubAppController],
  providers: [GithubAppService],
  exports: [GithubAppService],
})
export class GithubAppModule {}
