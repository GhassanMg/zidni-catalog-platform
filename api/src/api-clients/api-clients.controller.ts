import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { ApiAuth, RequirePermissions } from '../auth/decorators';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { PaginatedResponseDto, PaginationQueryDto } from '../common/dto/pagination.dto';
import { ReqCtx } from '../common/request-context';
import type { RequestContext } from '../common/request-context';
import { ApiClientsService } from './api-clients.service';
import { ApiClientDto, CreateApiClientDto, CreatedApiClientDto } from './dto/api-client.dto';

@ApiTags('API clients (AI agents)')
@ApiAuth()
@Controller('api-clients')
export class ApiClientsController {
  constructor(private readonly apiClients: ApiClientsService) {}

  @Post()
  @RequirePermissions(Permission.API_CLIENTS_MANAGE)
  @ApiOperation({ summary: 'Issue an API key for an AI agent (the key is returned once)' })
  @ApiCreatedResponse({ type: CreatedApiClientDto })
  @ApiErrors(400, 409)
  create(@Body() dto: CreateApiClientDto, @ReqCtx() ctx: RequestContext): Promise<CreatedApiClientDto> {
    return this.apiClients.create(dto, ctx);
  }

  @Get()
  @RequirePermissions(Permission.API_CLIENTS_MANAGE)
  @ApiOperation({ summary: 'List agent API clients (never includes key material)' })
  @ApiOkResponse({ type: PaginatedResponseDto(ApiClientDto) })
  @ApiErrors(400)
  list(@Query() query: PaginationQueryDto) {
    return this.apiClients.list(query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.API_CLIENTS_MANAGE)
  @ApiOperation({ summary: 'Revoke an agent API key (takes effect immediately)' })
  @ApiNoContentResponse()
  @ApiErrors(400, 404, 409)
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.apiClients.revoke(id);
  }
}
