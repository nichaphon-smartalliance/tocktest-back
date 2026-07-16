import { Controller, Post, Get, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AiService } from './ai.service';
import { GenerateTestCasesDto } from './dto/generate-test-cases.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { THROTTLE_AI } from '../../common/throttle.config';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('health')
  health() {
    return this.aiService.healthCheck();
  }

  @Throttle(THROTTLE_AI)
  @Post('generate-test-cases')
  generateTestCases(@CurrentUser() user: User, @Body() dto: GenerateTestCasesDto) {
    return this.aiService.generateTestCases(user.id, dto.repoId, {
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      commitShas: dto.commitShas,
      branch: dto.branch,
    });
  }
}
