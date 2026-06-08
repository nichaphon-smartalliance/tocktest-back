import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { GithubTokensService } from './github-tokens.service';
import { CreateGithubTokenDto } from './dto/create-github-token.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/github-tokens')
export class GithubTokensController {
  constructor(private readonly service: GithubTokensService) {}

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.service.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateGithubTokenDto) {
    return this.service.create(user.id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.service.delete(user.id, id);
  }

  @Post(':id/test')
  test(@CurrentUser() user: User, @Param('id') id: string) {
    return this.service.test(user.id, id);
  }
}
