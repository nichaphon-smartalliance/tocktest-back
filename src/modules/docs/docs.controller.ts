import { Controller, Get, Put, Post, Delete, Param, Body } from '@nestjs/common';
import { DocsService } from './docs.service';
import { UpdateDocDto } from './dto/update-doc.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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

  @Put(':repoId/docs')
  updateDoc(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: UpdateDocDto,
  ) {
    return this.service.updateDoc(user.id, repoId, dto.content);
  }

  @Post(':repoId/docs/auto-update')
  autoUpdate(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    console.log('DocsController.autoUpdate called', { userId: user?.id, repoId });
    return this.service.autoUpdate(user.id, repoId);
  }

  @Delete(':repoId/docs')
  deleteDoc(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    return this.service.deleteDoc(user.id, repoId);
  }
}
