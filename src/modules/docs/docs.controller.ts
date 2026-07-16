import { Controller, Get, Put, Post, Delete, Param, Body, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DocsService } from './docs.service';
import { UpdateDocDto } from './dto/update-doc.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { THROTTLE_AI } from '../../common/throttle.config';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class DocsController {
  constructor(private readonly service: DocsService) {}

  @Get(':repoId/docs/versions')
  getVersions(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    return this.service.getVersions(user.id, repoId);
  }

  @Get(':repoId/docs')
  getDoc(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    return this.service.getLatestDoc(user.id, repoId);
  }

  @Get(':repoId/docs/status')
  getStatus(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    return this.service.getStatus(user.id, repoId);
  }

  @Put(':repoId/docs')
  updateDoc(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: UpdateDocDto,
  ) {
    return this.service.updateDoc(user.id, repoId, dto.content);
  }

  @Throttle(THROTTLE_AI)
  @Post(':repoId/docs/gen')
  generate(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    if (!user || !user.id) throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อน');
    return this.service.generate(user.id, repoId);
  }

  @Throttle(THROTTLE_AI)
  @Post(':repoId/docs/refresh')
  refresh(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    if (!user || !user.id) throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อน');
    return this.service.refresh(user.id, repoId);
  }

  @Throttle(THROTTLE_AI)
  @Post(':repoId/docs/auto-update')
  autoUpdate(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    if (!user || !user.id) throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อน');
    return this.service.autoUpdate(user.id, repoId);
  }

  @Delete(':repoId/docs')
  deleteDoc(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    return this.service.deleteDoc(user.id, repoId);
  }
}
