import { Body, Controller, Param, Post } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { ChatRequestDto } from './dto/chat.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post(':repoId/chat')
  chat(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: ChatRequestDto,
  ) {
    return this.chatbotService.chat(user.id, repoId, dto);
  }
}
