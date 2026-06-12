import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import type { User } from '../users/entities/user.entity';
import type { LoginDto } from './dto/login.dto';
import type { GithubLoginDto } from './dto/github-login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.passwordHash) throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');

    // pgcrypto uses $2a$ prefix; bcryptjs handles both $2a$ and $2b$
    const hash = user.passwordHash.replace(/^\$2a\$/, '$2b$');
    const isValid = await bcrypt.compare(dto.password, hash);
    if (!isValid) throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');

    return this.buildSession(user);
  }

  async loginWithGithub(dto: GithubLoginDto) {
    const user = await this.usersService.upsertGithubUser({
      githubId: dto.githubId,
      githubLogin: dto.githubLogin,
      email: dto.email,
      name: dto.name,
      avatarUrl: dto.avatarUrl,
    });
    if (!user.isActive) throw new UnauthorizedException('บัญชีนี้ถูกปิดใช้งาน');
    return this.buildSession(user);
  }

  private buildSession(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        authProvider: user.authProvider,
        avatarUrl: user.avatarUrl,
        githubLogin: user.githubLogin,
        createdAt: user.createdAt,
      },
    };
  }
}
