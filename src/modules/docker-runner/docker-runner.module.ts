import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerRunnerController } from './docker-runner.controller';
import { DockerRunnerService } from './docker-runner.service';
import { TestRun } from './entities/test-run.entity';
import { Repository } from '../repositories/entities/repository.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TestRun, Repository])],
  controllers: [DockerRunnerController],
  providers: [DockerRunnerService],
})
export class DockerRunnerModule {}
