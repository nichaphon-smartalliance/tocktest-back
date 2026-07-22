import { Module } from '@nestjs/common';
import { GithubApiClient } from './github-api.client';

@Module({
  providers: [GithubApiClient],
  exports: [GithubApiClient],
})
export class GithubApiModule {}
