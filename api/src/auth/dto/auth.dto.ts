import { ApiProperty } from '@nestjs/swagger';
import { ActorType, Permission, Role } from '@prisma/client';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { LowerCase, Trim } from '../../common/dto/transforms';
import { UserDto } from '../../users/dto/user.dto';

export class RegisterDto {
  @ApiProperty({ example: 'jane@example.com', maxLength: 254 })
  @LowerCase()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Jane Doe', minLength: 2, maxLength: 100 })
  @Trim()
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({
    example: 'S3cure#Passw0rd',
    minLength: 8,
    maxLength: 72,
    description: 'At least 8 characters, including a letter and a digit (max 72 bytes, bcrypt limit).',
  })
  @IsString()
  @Length(8, 72)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'password must contain at least one letter and one digit',
  })
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'admin@zidni.local' })
  @LowerCase()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Admin@12345' })
  @IsString()
  @Length(1, 128)
  password: string;
}

export class TokenResponseDto {
  @ApiProperty({ description: 'JWT access token; send as `Authorization: Bearer <token>`' })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ example: 900, description: 'Lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}

export class PrincipalDto {
  @ApiProperty({ enum: [ActorType.USER, ActorType.AGENT] })
  type: 'USER' | 'AGENT';

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'catalog-agent', description: 'User e-mail or agent name' })
  label: string;

  @ApiProperty({ enum: Role, enumName: 'Role', nullable: true })
  role: Role | null;

  @ApiProperty({ enum: Permission, enumName: 'Permission', isArray: true })
  permissions: Permission[];
}
