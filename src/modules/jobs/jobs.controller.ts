import { Controller, Get } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('api/v1/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('stats')
  getStats() {
    return this.jobs.getStats();
  }

  @Get('recent')
  getRecent() {
    return this.jobs.getRecent(30);
  }
}
