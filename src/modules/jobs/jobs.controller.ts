import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('stats')
  getStats(@CurrentUser() user: User) {
    this.assertAdmin(user);
    return this.jobs.getStats();
  }

  @Get('recent')
  getRecent(@CurrentUser() user: User) {
    this.assertAdmin(user);
    return this.jobs.getRecent(30);
  }

  private assertAdmin(user: User) {
    if (user.role !== 'admin') throw new ForbiddenException('Admin access required');
  }
}
