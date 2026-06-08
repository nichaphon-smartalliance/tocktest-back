import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubToken } from './entities/github-token.entity';
import { GithubTokensController } from './github-tokens.controller';
import { GithubTokensService } from './github-tokens.service';

@Module({
  imports: [TypeOrmModule.forFeature([GithubToken])],
  controllers: [GithubTokensController],
  providers: [GithubTokensService],
  exports: [GithubTokensService],
})
export class GithubTokensModule {}
