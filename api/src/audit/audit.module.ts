import { Global, Module } from '@nestjs/common';
import { AuditFailureInterceptor } from './audit-failure.interceptor';
import { AuditFailureRecorder } from './audit-failure.recorder';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditFailureRecorder, AuditFailureInterceptor],
  exports: [AuditService, AuditFailureRecorder, AuditFailureInterceptor],
})
export class AuditModule {}
