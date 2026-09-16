import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import type { ChatActor } from './chat.service';
import { ListMessageDto, SendMessageDto } from './dto/chat.dto';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private gateway: ChatGateway,
  ) {}

  @ApiOperation({ summary: 'Mở (hoặc lấy lại) hội thoại với shop' })
  @Post('conversations')
  async openConversation(@CurrentUser() user: AuthUser) {
    return {
      conversation: await this.chatService.openConversation(user.id),
    };
  }

  @ApiOperation({
    summary: 'Danh sách hội thoại (khách: của mình; admin: tất cả)',
  })
  @Get('conversations')
  listConversations(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationDto,
  ) {
    return this.chatService.listConversations(actorOf(user), query);
  }

  @ApiOperation({ summary: 'Tin nhắn của một hội thoại' })
  @Get('messages')
  listMessages(@CurrentUser() user: AuthUser, @Query() query: ListMessageDto) {
    return this.chatService.listMessages(actorOf(user), query);
  }

  @ApiOperation({ summary: 'Gửi tin nhắn' })
  @Post('messages')
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.chatService.sendMessage(actorOf(user), dto);

    // Đẩy realtime SAU khi đã ghi DB: người nhận tải lại trang phải thấy đúng
    // thứ vừa hiện ra, không phải một tin nhắn biến mất.
    this.gateway.emitMessage(message);

    return { message };
  }

  @ApiOperation({ summary: 'Đánh dấu tin nhắn đã đọc' })
  @Patch('messages/:id/read')
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const message = await this.chatService.markRead(actorOf(user), id);
    this.gateway.emitRead(message);

    return { message };
  }
}

function actorOf(user: AuthUser): ChatActor {
  return { id: user.id, roles: user.roles };
}
