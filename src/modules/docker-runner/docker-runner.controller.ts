import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DockerRunnerService } from './docker-runner.service';
import { RunTestsDto } from './dto/run-tests.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class DockerRunnerController {
  constructor(private readonly dockerRunner: DockerRunnerService) {}

  @Get(':repoId/sandbox/status')
  async sandboxStatus() {
    const available = await this.dockerRunner.isDockerAvailable();
    return { available };
  }

  @Post(':repoId/sandbox/run')
  enqueueRun(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: RunTestsDto,
  ) {
    return this.dockerRunner.enqueueRun(user.id, repoId, dto);
  }

  @Get(':repoId/sandbox/runs')
  listRuns(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Query('limit') limit?: number,
  ) {
    return this.dockerRunner.listRuns(user.id, repoId, limit);
  }

  @Get(':repoId/sandbox/runs/:runId')
  getRunStatus(
    @CurrentUser() user: User,
    @Param('runId') runId: string,
  ) {
    return this.dockerRunner.getRunStatus(user.id, runId);
  }
}
