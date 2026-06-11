import { Module } from '@nestjs/common';
import { GithubAppController } from './github-app.controller';
import { GithubAppService } from './github-app.service';

@Module({
  controllers: [GithubAppController],
  providers: [GithubAppService],
  exports: [GithubAppService],
})
export class GithubAppModule {}
