import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import type { User } from '../users/entities/user.entity';
import type { LoginDto } from './dto/login.dto';
import type { GithubLoginDto } from './dto/github-login.dto';

@Injectable()
export class AuthService {
  // A constant bcrypt hash compared against when the account doesn't exist, so
  // login response time is the same whether or not the email is registered
  // (defeats timing-based user enumeration).
  private static readonly DUMMY_HASH = bcrypt.hashSync('tocktest-timing-equalizer', 12);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    // Always run one bcrypt comparison — even for a missing user — so the
    // response timing can't reveal whether the email exists.
    // pgcrypto uses $2a$ while bcryptjs expects $2b$ when comparing hashes.
    const hash = user?.passwordHash?.replace(/^\$2a\$/, '$2b$') ?? AuthService.DUMMY_HASH;
    const passwordOk = await bcrypt.compare(dto.password, hash);

    if (!user || !user.passwordHash || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildSession(user);
  }

  async loginWithGithub(dto: GithubLoginDto) {
    const profile = await this.fetchGithubProfile(dto.accessToken);
    const user = await this.usersService.upsertGithubUser({
      githubId: profile.id,
      githubLogin: profile.login,
      email: profile.email ?? undefined,
      name: profile.name ?? undefined,
      avatarUrl: profile.avatarUrl ?? undefined,
    });
    if (!user.isActive) {
      throw new UnauthorizedException('This account is disabled');
    }
    return this.buildSession(user);
  }

  private async fetchGithubProfile(accessToken: string) {
    try {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      };
      const [profileRes, emailsRes] = await Promise.all([
        axios.get('https://api.github.com/user', { headers, timeout: 10000 }),
        axios.get('https://api.github.com/user/emails', { headers, timeout: 10000 }),
      ]);

      const verifiedEmail = Array.isArray(emailsRes.data)
        ? emailsRes.data.find((item: any) => item?.primary && item?.verified)?.email ??
          emailsRes.data.find((item: any) => item?.verified)?.email ??
          null
        : null;

      if (!profileRes.data?.id || !profileRes.data?.login) {
        throw new UnauthorizedException('Invalid GitHub profile');
      }

      return {
        id: Number(profileRes.data.id),
        login: String(profileRes.data.login),
        email: typeof verifiedEmail === 'string' ? verifiedEmail : null,
        name: typeof profileRes.data.name === 'string' ? profileRes.data.name : null,
        avatarUrl: typeof profileRes.data.avatar_url === 'string' ? profileRes.data.avatar_url : null,
      };
    } catch {
      throw new UnauthorizedException('GitHub authentication failed');
    }
  }

  private buildSession(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role, sv: user.sessionVersion };
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
