import { Controller, Get, Put, Param, Body,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get(':repoId/settings')
  getSettings(@CurrentUser() user: User, @Param('repoId', ParseUUIDPipe) repoId: string) {
    return this.service.getSettings(user.id, repoId);
  }

  @Put(':repoId/settings')
  updateSettings(
    @CurrentUser() user: User,
    @Param('repoId', ParseUUIDPipe) repoId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.service.updateSettings(user.id, repoId, dto);
  }
}
