import { Controller, Post, Body } from '@nestjs/common';
import { AiService } from './ai.service';
import { GenerateTestCasesDto } from './dto/generate-test-cases.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate-test-cases')
  generateTestCases(@CurrentUser() user: User, @Body() dto: GenerateTestCasesDto) {
    console.log('Received request to generate test cases for user:', user.id, 'with repoId:', dto.repoId);
    return this.aiService.generateTestCases(user.id, dto.repoId, {
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      commitShas: dto.commitShas,
    });
  }
}
