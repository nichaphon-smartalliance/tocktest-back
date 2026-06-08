import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IsArray, IsString } from 'class-validator';
import type { User } from '../users/entities/user.entity';

class WhatToTestDto {
  @IsArray()
  @IsString({ each: true })
  commitShas: string[];
}

@Controller('api/v1/repositories')
export class AnalysisController {
  constructor(private readonly service: AnalysisService) {}

  @Get(':repoId/commits')
  getCommits(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Query() pagination: PaginationDto,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('riskLevel') riskLevel?: string,
  ) {
    return this.service.getCommits(user.id, repoId, { ...pagination, fromDate, toDate, riskLevel });
  }

  @Post(':repoId/commits/:sha/analyze')
  analyzeCommit(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('sha') sha: string,
  ) {
    return this.service.analyzeCommit(user.id, repoId, sha);
  }

  @Post(':repoId/what-to-test')
  getWhatToTest(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: WhatToTestDto,
  ) {
    return this.service.getWhatToTest(user.id, repoId, dto.commitShas);
  }
}
