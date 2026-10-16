import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, AuditResource, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { toUserDto, UserDto } from '../users/dto/user.dto';
import { UsersService } from '../users/users.service';
import { parseApiKey, verifyApiKey } from './api-key';
import { LoginDto, RegisterDto, TokenResponseDto } from './dto/auth.dto';
import { permissionsForRole } from './permissions';
import type { Principal } from './principal';

interface AccessTokenPayload {
  sub: string;
  role: Role;
}

const LAST_USED_RESOLUTION_MS = 60_000;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly bcryptRounds: number;
  private readonly tokenTtl: number;
  /** Compared against when the e-mail is unknown, so response time does not reveal which e-mails exist. */
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.bcryptRounds = config.get('BCRYPT_ROUNDS', { infer: true });
    this.tokenTtl = config.get('JWT_TTL_SECONDS', { infer: true });
  }

  onModuleInit(): void {
    this.dummyHash = bcrypt.hashSync('timing-equaliser-not-a-real-password', this.bcryptRounds);
  }

  async register(dto: RegisterDto, ctx: RequestContext): Promise<UserDto> {
    if (Buffer.byteLength(dto.password, 'utf8') > 72) {
      throw new BadRequestException('password must not exceed 72 bytes');
    }
    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
    return this.prisma.$transaction(async (tx) => {
      // Self-registration can only ever create a normal user; admins are provisioned out-of-band.
      const user = await tx.user.create({
        data: { email: dto.email, name: dto.name, passwordHash, role: Role.USER },
      });
      const snapshot = toUserDto(user);
      await this.audit.record(tx, ctx, {
        action: AuditAction.CREATE,
        resourceType: AuditResource.USER,
        resourceId: user.id,
        changes: { after: snapshot },
        actor: { type: 'USER', id: user.id, label: user.email },
      });
      return snapshot;
    });
  }

  async login(dto: LoginDto): Promise<TokenResponseDto> {
    const user = await this.users.findByEmail(dto.email);
    const passwordMatches = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !passwordMatches || !user.isActive) {
      throw new UnauthorizedException('Invalid e-mail or password');
    }
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.tokenTtl,
      user: toUserDto(user),
    };
  }

  /**
   * Verifies signature/expiry/issuer/audience, then re-loads the user so that a disabled
   * account or a role change takes effect immediately instead of when the token expires.
   */
  async authenticateAccessToken(token: string): Promise<Principal> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is disabled or no longer exists');
    }
    return {
      type: 'USER',
      id: user.id,
      label: user.email,
      role: user.role,
      permissions: permissionsForRole(user.role),
    };
  }

  async authenticateApiKey(key: string): Promise<Principal> {
    const parsed = parseApiKey(key);
    if (!parsed) throw new UnauthorizedException('Invalid API key');

    const client = await this.prisma.apiClient.findUnique({ where: { keyPrefix: parsed.prefix } });
    if (!client || !verifyApiKey(key, client.keyHash)) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (client.revokedAt) throw new UnauthorizedException('API key has been revoked');
    const now = new Date();
    if (client.expiresAt && client.expiresAt <= now) {
      throw new UnauthorizedException('API key has expired');
    }

    if (!client.lastUsedAt || now.getTime() - client.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      // Best effort, off the request path: a failure here must not fail the request.
      this.prisma.apiClient
        .update({ where: { id: client.id }, data: { lastUsedAt: now } })
        .catch((error: Error) => this.logger.warn(`Could not update lastUsedAt: ${error.message}`));
    }

    return {
      type: 'AGENT',
      id: client.id,
      label: client.name,
      role: null,
      permissions: client.permissions,
    };
  }
}
