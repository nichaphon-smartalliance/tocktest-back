import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';
import { GithubAppService } from './github-app.service';
import { ImportRepositoryDto } from './dto/import-repository.dto';
import { resolveFrontendRedirectBase } from '../../common/utils/frontend-url.util';

@Controller('api/v1/github-app')
export class GithubAppController {
  constructor(private readonly githubAppService: GithubAppService) {}

  @Get('setup')
  getSetupStatus() {
    return this.githubAppService.getSetupStatus();
  }

  @Get('install-url')
  getInstallUrl(@CurrentUser() user: User) {
    return { url: this.githubAppService.getInstallUrl(user.id) };
  }

  @Get('installations')
  getInstallations(@CurrentUser() user: User) {
    return this.githubAppService.getInstallationsForUser(user.id);
  }

  @Get('installations/:installationId/repositories')
  getInstallationRepositories(
    @CurrentUser() user: User,
    @Param('installationId') installationId: string,
  ) {
    return this.githubAppService.getInstallationRepositories(user.id, installationId);
  }

  @Post('installations/:installationId/repositories/import')
  importInstallationRepository(
    @CurrentUser() user: User,
    @Param('installationId') installationId: string,
    @Body() dto: ImportRepositoryDto,
  ) {
    return this.githubAppService.importInstallationRepository(user.id, installationId, dto.fullName);
  }

  @Public()
  @Get('installation/callback')
  async installationCallback(
    @Query('installation_id') installationId: string | undefined,
    @Query('setup_action') setupAction: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const frontendUrl = resolveFrontendRedirectBase();
    try {
      await this.githubAppService.handleInstallationCallback(installationId, setupAction, state);
      const params = new URLSearchParams({ github_app: setupAction ?? 'installed' });
      if (installationId) params.set('installation_id', installationId);
      return res.redirect(`${frontendUrl}/settings?${params.toString()}`);
    } catch {
      return res.redirect(`${frontendUrl}/settings?github_app=error`);
    }
  }
}
