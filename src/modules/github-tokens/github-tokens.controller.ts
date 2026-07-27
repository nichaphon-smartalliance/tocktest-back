import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { GithubTokensService } from './github-tokens.service';
import { CreateGithubTokenDto } from './dto/create-github-token.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { resolveFrontendRedirectBase } from '../../common/utils/frontend-url.util';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/github-tokens')
export class GithubTokensController {
  constructor(private readonly service: GithubTokensService) {}

  @Get('oauth/connect-url')
  getOAuthConnectUrl(@CurrentUser() user: User) {
    return { url: this.service.getOAuthConnectUrl(user.id) };
  }

  @Public()
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = resolveFrontendRedirectBase();
    if (error || !code || !state) {
      return res.redirect(`${frontendUrl}/settings?github=error`);
    }
    try {
      await this.service.handleOAuthCallback(code, state);
      return res.redirect(`${frontendUrl}/settings?github=connected`);
    } catch {
      return res.redirect(`${frontendUrl}/settings?github=error`);
    }
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.service.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateGithubTokenDto) {
    return this.service.create(user.id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(user.id, id);
  }

  @Post(':id/test')
  test(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.test(user.id, id);
  }
}
