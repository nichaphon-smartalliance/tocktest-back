import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectDoc } from './entities/project-doc.entity';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { DocsSourceService } from './docs-source.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { RepoSettings } from '../settings/entities/repo-settings.entity';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';
import { UsersModule } from '../users/users.module';
import { GithubApiModule } from '../../common/github/github-api.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectDoc, RepoSettings]),
    GithubTokensModule,
    RepositoriesModule,
    UsersModule,
    GithubApiModule,
  ],
  controllers: [DocsController],
  providers: [DocsService, DocsSourceService],
})
export class DocsModule {}
