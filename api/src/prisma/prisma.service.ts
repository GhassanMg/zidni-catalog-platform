import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: ConfigService<Env, true>) {
    super({ datasourceUrl: config.get('DATABASE_URL', { infer: true }) });
  }

  /**
   * Retries the initial connection so the API survives starting before the database
   * is ready (e.g. container start-up ordering, a DB restart during deploy).
   */
  async onModuleInit(): Promise<void> {
    const retries = this.config.get('DB_CONNECT_RETRIES', { infer: true });
    const baseDelay = this.config.get('DB_CONNECT_RETRY_DELAY_MS', { infer: true });

    for (let attempt = 0; ; attempt++) {
      try {
        await this.$connect();
        if (attempt > 0) this.logger.log(`Connected to database after ${attempt} retries`);
        return;
      } catch (error) {
        if (attempt >= retries) {
          this.logger.error(`Could not connect to database after ${attempt} retries`);
          throw error;
        }
        const delay = Math.min(baseDelay * 2 ** attempt, 10_000);
        this.logger.warn(
          `Database connection failed (attempt ${attempt + 1}/${retries + 1}): ${
            (error as Error).message
          }. Retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
