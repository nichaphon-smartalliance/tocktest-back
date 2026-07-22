import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from './entities/repository.entity';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';
import { GithubApiModule } from '../../common/github/github-api.module';

@Module({
  imports: [TypeOrmModule.forFeature([Repository]), GithubTokensModule, GithubApiModule],
  controllers: [RepositoriesController],
  providers: [RepositoriesService],
  exports: [RepositoriesService],
})
export class RepositoriesModule {}
