import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiTags('health')
  @ApiOperation({ summary: 'Health check — trả về commit đang chạy' })
  @Get('health')
  health() {
    return this.appService.health();
  }
}
