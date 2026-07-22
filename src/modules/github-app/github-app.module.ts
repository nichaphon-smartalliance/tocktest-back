import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubAppController } from './github-app.controller';
import { GithubAppService } from './github-app.service';
import { GithubInstallation } from './entities/github-installation.entity';
import { Repository } from '../repositories/entities/repository.entity';
import { GithubApiModule } from '../../common/github/github-api.module';

@Module({
  imports: [TypeOrmModule.forFeature([GithubInstallation, Repository]), GithubApiModule],
  controllers: [GithubAppController],
  providers: [GithubAppService],
  exports: [GithubAppService],
})
export class GithubAppModule {}
