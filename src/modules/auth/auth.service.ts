import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import type { User } from '../users/entities/user.entity';
import type { LoginDto } from './dto/login.dto';
import type { GithubLoginDto } from './dto/github-login.dto';
import { GithubApiClient } from '../../common/github/github-api.client';

@Injectable()
export class AuthService {
  // A constant bcrypt hash compared against when the account doesn't exist, so
  // login response time is the same whether or not the email is registered
  // (defeats timing-based user enumeration).
  private static readonly DUMMY_HASH = bcrypt.hashSync('tocktest-timing-equalizer', 12);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly githubApi: GithubApiClient,
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
      const [profile, emails] = await Promise.all([
        this.githubApi.getUser(accessToken),
        this.githubApi.getUserEmails(accessToken),
      ]);

      const verifiedEmail =
        emails.find((item) => item?.primary && item?.verified)?.email ??
        emails.find((item) => item?.verified)?.email ??
        null;

      if (!profile?.id || !profile?.login) {
        throw new UnauthorizedException('Invalid GitHub profile');
      }

      return {
        id: Number(profile.id),
        login: String(profile.login),
        email: typeof verifiedEmail === 'string' ? verifiedEmail : null,
        name: typeof profile.name === 'string' ? profile.name : null,
        avatarUrl: typeof profile.avatar_url === 'string' ? profile.avatar_url : null,
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
