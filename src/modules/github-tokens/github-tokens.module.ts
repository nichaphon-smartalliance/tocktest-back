import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubToken } from './entities/github-token.entity';
import { GithubTokensController } from './github-tokens.controller';
import { GithubTokensService } from './github-tokens.service';
import { Repository } from '../repositories/entities/repository.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GithubToken, Repository])],
  controllers: [GithubTokensController],
  providers: [GithubTokensService],
  exports: [GithubTokensService],
})
export class GithubTokensModule {}
