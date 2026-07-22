import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { Repository } from '../repositories/entities/repository.entity';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';
import { RepoSettings } from '../settings/entities/repo-settings.entity';
import { GithubApiModule } from '../../common/github/github-api.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Repository, RepoSettings]),
    GithubTokensModule,
    GithubApiModule,
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
