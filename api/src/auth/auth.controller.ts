import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { UserDto } from '../users/dto/user.dto';
import { AuthService } from './auth.service';
import { ApiAuth, CurrentPrincipal, Public } from './decorators';
import { LoginDto, PrincipalDto, RegisterDto, TokenResponseDto } from './dto/auth.dto';
import type { Principal } from './principal';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Self-register a normal (read-only) user account' })
  @ApiCreatedResponse({ type: UserDto })
  @ApiErrors(400, 409, 429)
  register(@Body() dto: RegisterDto): Promise<UserDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Exchange e-mail/password for a short-lived JWT access token' })
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiErrors(400, 401, 429)
  login(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    return this.auth.login(dto);
  }

  @Get('me')
  @ApiAuth()
  @ApiOperation({ summary: 'Describe the calling identity (user or agent) and its permissions' })
  @ApiOkResponse({ type: PrincipalDto })
  me(@CurrentPrincipal() principal: Principal): PrincipalDto {
    return {
      type: principal.type,
      id: principal.id,
      label: principal.label,
      role: principal.role,
      permissions: principal.permissions,
    };
  }
}
