import { Controller, Get, Post, Param, Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RepositoriesService } from './repositories.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class RepositoriesController {
  constructor(private readonly service: RepositoriesService) {}

  @Get()
  findAll(
    @CurrentUser() user: User,
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(user.id, { ...pagination, search });
  }

  @Post('sync')
  syncFromGithub(@CurrentUser() user: User) {
    return this.service.syncFromGithub(user.id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(user.id, id);
  }

  @Get(':id/branches')
  getBranches(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getBranches(user.id, id);
  }
}
