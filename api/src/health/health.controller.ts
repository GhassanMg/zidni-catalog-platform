import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

const DB_PING_TIMEOUT_MS = 2_000;

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is up and serving HTTP' })
  @ApiOkResponse({ schema: { example: { status: 'ok', uptimeSeconds: 42 } } })
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: dependencies (database) are reachable' })
  @ApiOkResponse({ schema: { example: { status: 'ok', checks: { database: 'up' } } } })
  @ApiServiceUnavailableResponse({ description: 'Database unreachable' })
  async ready() {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), DB_PING_TIMEOUT_MS).unref(),
        ),
      ]);
      return { status: 'ok', checks: { database: 'up' } };
    } catch {
      throw new ServiceUnavailableException({
        message: 'Service not ready',
        details: { database: 'down' },
      });
    }
  }
}
