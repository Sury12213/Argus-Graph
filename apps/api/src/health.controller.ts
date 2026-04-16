import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'argus-graph-api',
      version: '3.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
