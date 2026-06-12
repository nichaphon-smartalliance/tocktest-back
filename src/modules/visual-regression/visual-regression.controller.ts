import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { VisualRegressionService } from './visual-regression.service';
import { CreateBaselineDto, CompareDto } from './dto/visual.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class VisualRegressionController {
  constructor(private readonly visualService: VisualRegressionService) {}

  @Post(':repoId/visual/baselines')
  createBaseline(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: CreateBaselineDto,
  ) {
    return this.visualService.createBaseline(user.id, repoId, dto);
  }

  @Get(':repoId/visual/baselines')
  listBaselines(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    return this.visualService.listBaselines(user.id, repoId);
  }

  @Get(':repoId/visual/baselines/:baselineId')
  getBaseline(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('baselineId') baselineId: string,
  ) {
    return this.visualService.getBaseline(user.id, repoId, baselineId);
  }

  @Delete(':repoId/visual/baselines/:baselineId')
  deleteBaseline(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('baselineId') baselineId: string,
  ) {
    return this.visualService.deleteBaseline(user.id, repoId, baselineId);
  }

  @Post(':repoId/visual/compare')
  compare(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: CompareDto,
  ) {
    return this.visualService.compare(user.id, repoId, dto);
  }

  @Get(':repoId/visual/comparisons')
  listComparisons(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Query('baselineId') baselineId?: string,
  ) {
    return this.visualService.listComparisons(user.id, repoId, baselineId);
  }
}
