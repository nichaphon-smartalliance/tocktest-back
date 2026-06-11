import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from '../repositories/entities/repository.entity';
import { TestCase } from '../test-cases/entities/test-case.entity';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Repository, TestCase]), GithubTokensModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
