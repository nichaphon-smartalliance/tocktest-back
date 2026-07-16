import { Controller, Get, Post, Param, Query, Body, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnalysisService } from './analysis.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WhatToTestDto } from './dto/what-to-test.dto';
import { THROTTLE_AI, THROTTLE_EXTERNAL_WRITE } from '../../common/throttle.config';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class AnalysisController {
  constructor(private readonly service: AnalysisService) {}

  @Throttle(THROTTLE_AI)
  @Post(':repoId/commits/sync')
  syncCommits(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Query('branch') branch?: string,
  ) {
    return this.service.syncCommitsFromGithub(user.id, repoId, branch);
  }

  @Get(':repoId/commits')
  getCommits(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Query() pagination: PaginationDto,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('branch') branch?: string,
  ) {
    return this.service.getCommits(user.id, repoId, { ...pagination, fromDate, toDate, riskLevel, branch });
  }

  @Throttle(THROTTLE_AI)
  @Post(':repoId/commits/:sha/analyze')
  analyzeCommit(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('sha') sha: string,
  ) {
    if (!user?.id) throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อน');
    return this.service.analyzeCommit(user.id, repoId, sha);
  }

  @Throttle(THROTTLE_AI)
  @Post(':repoId/what-to-test')
  getWhatToTest(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: WhatToTestDto,
  ) {
    if (!user?.id) throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อน');
    return this.service.getWhatToTest(user.id, repoId, dto.commitShas);
  }
  @Throttle(THROTTLE_AI)
  @Post(':repoId/pull-requests/:pullRequestNumber/review')
  reviewPullRequest(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('pullRequestNumber') pullRequestNumber: string,
  ) {
    if (!user?.id) throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อน');
    return this.service.reviewPullRequest(user.id, repoId, Number(pullRequestNumber));
  }

  @Throttle(THROTTLE_EXTERNAL_WRITE)
  @Post(':repoId/pull-requests/:pullRequestNumber/review/comment')
  reviewAndCommentPullRequest(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('pullRequestNumber') pullRequestNumber: string,
  ) {
    if (!user?.id) throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อน');
    return this.service.reviewAndCommentPullRequest(user.id, repoId, Number(pullRequestNumber));
  }
}
