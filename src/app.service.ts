import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  health() {
    return {
      status: 'ok',
      version: process.env.GIT_SHA ?? 'unknown',
      uptime: Math.floor(process.uptime()),
    };
  }
}
