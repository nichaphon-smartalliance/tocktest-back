import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { GithubAppService } from './github-app.service';

@Controller('api/v1/github-app')
export class GithubAppController {
  constructor(private readonly githubAppService: GithubAppService) {}

  @Get('setup')
  getSetupStatus() {
    return this.githubAppService.getSetupStatus();
  }

  @Public()
  @Post('webhooks/github')
  receiveGithubWebhook(
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-hub-signature-256') signature256: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: any,
  ) {
    return this.githubAppService.handleWebhook(
      { event, deliveryId, signature256 },
      req.rawBody,
      body,
    );
  }
}
