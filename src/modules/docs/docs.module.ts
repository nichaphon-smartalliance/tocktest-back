import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectDoc } from './entities/project-doc.entity';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { RepoSettings } from '../settings/entities/repo-settings.entity';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectDoc, RepoSettings]),
    GithubTokensModule,
    RepositoriesModule,
  ],
  controllers: [DocsController],
  providers: [DocsService],
})
export class DocsModule {}
