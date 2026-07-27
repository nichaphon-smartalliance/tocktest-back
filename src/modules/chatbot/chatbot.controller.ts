import { Body, Controller, Param, Post,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ChatbotService } from './chatbot.service';
import { ChatRequestDto } from './dto/chat.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { THROTTLE_AI } from '../../common/throttle.config';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Throttle(THROTTLE_AI)
  @Post(':repoId/chat')
  chat(
    @CurrentUser() user: User,
    @Param('repoId', ParseUUIDPipe) repoId: string,
    @Body() dto: ChatRequestDto,
  ) {
    return this.chatbotService.chat(user.id, repoId, dto);
  }
}
