import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { ApiAuth, RequirePermissions } from '../auth/decorators';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';
import { AuditService } from './audit.service';
import { AuditLogDto, ListAuditLogsQueryDto } from './dto/audit-log.dto';

@ApiTags('Audit log')
@ApiAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({ summary: 'Query the append-only audit trail (newest first)' })
  @ApiOkResponse({ type: PaginatedResponseDto(AuditLogDto) })
  @ApiErrors(400)
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.audit.list(query);
  }
}
