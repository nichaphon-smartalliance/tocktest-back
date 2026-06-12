import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { GithubToken } from './entities/github-token.entity';
import { encrypt, decrypt } from '../../common/utils/encryption.util';
import type { CreateGithubTokenDto } from './dto/create-github-token.dto';

@Injectable()
export class GithubTokensService {
  constructor(
    @InjectRepository(GithubToken)
    private readonly tokenRepo: Repository<GithubToken>,
    private readonly config: ConfigService,
  ) {}

  async findAll(userId: string) {
    const tokens = await this.tokenRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    return tokens.map((t) => this.toPublicToken(t));
  }

  async create(userId: string, dto: CreateGithubTokenDto) {
    const encrypted = encrypt(dto.token);
    const token = this.tokenRepo.create({
      userId,
      label: dto.label,
      tokenEncrypted: encrypted,
      isActive: true,
    });
    const saved = await this.tokenRepo.save(token);
    return this.toPublicToken(saved);
  }

  private toPublicToken(token: GithubToken) {
    const { tokenEncrypted: _tokenEncrypted, user: _user, ...safe } = token;
    return safe;
  }

  async delete(userId: string, tokenId: string): Promise<void> {
    const token = await this.tokenRepo.findOne({ where: { id: tokenId, userId } });
    if (!token) throw new NotFoundException('Token not found');
    await this.tokenRepo.remove(token);
  }

  async test(userId: string, tokenId: string): Promise<{ valid: boolean }> {
    const token = await this.tokenRepo.findOne({ where: { id: tokenId, userId } });
    if (!token) throw new NotFoundException('Token not found');

    try {
      const pat = decrypt(token.tokenEncrypted);
      await axios.get('https://api.github.com/user', {
        headers: { Authorization: `token ${pat}` },
      });
      await this.tokenRepo.update(tokenId, { lastTestedAt: new Date() });
      return { valid: true };
    } catch {
      return { valid: false };
    }
  }

  async hasActiveToken(userId: string): Promise<boolean> {
    return (await this.tokenRepo.count({ where: { userId, isActive: true } })) > 0;
  }

  async getDecryptedToken(userId: string): Promise<string | null> {
    const token = await this.tokenRepo.findOne({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    if (!token) return null;
    return decrypt(token.tokenEncrypted);
  }

  async getDecryptedTokenById(userId: string, tokenId: string): Promise<string | null> {
    const token = await this.tokenRepo.findOne({ where: { id: tokenId, userId } });
    if (!token) return null;
    return decrypt(token.tokenEncrypted);
  }

  getOAuthConnectUrl(userId: string): string {
    const clientId = this.config.get<string>('GITHUB_OAUTH_CLIENT_ID');
    const callbackUrl = this.config.get<string>('GITHUB_OAUTH_CALLBACK_URL');
    if (!clientId || !callbackUrl) {
      throw new BadRequestException('GitHub OAuth ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์');
    }

    const state = jwt.sign({ userId, purpose: 'github-oauth' }, this.config.get<string>('JWT_SECRET') as string, {
      expiresIn: '10m',
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: 'repo read:user',
      state,
      allow_signup: 'false',
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async handleOAuthCallback(code: string, state: string): Promise<{ userId: string; githubLogin: string }> {
    let payload: { userId: string; purpose: string };
    try {
      payload = jwt.verify(state, this.config.get<string>('JWT_SECRET') as string) as unknown as typeof payload;
    } catch {
      throw new UnauthorizedException('ลิงก์เชื่อมต่อ GitHub หมดอายุหรือไม่ถูกต้อง');
    }
    if (payload.purpose !== 'github-oauth' || !payload.userId) {
      throw new UnauthorizedException('สถานะการเชื่อมต่อ GitHub ไม่ถูกต้อง');
    }

    const tokenRes = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: this.config.get<string>('GITHUB_OAUTH_CLIENT_ID'),
        client_secret: this.config.get<string>('GITHUB_OAUTH_CLIENT_SECRET'),
        code,
        redirect_uri: this.config.get<string>('GITHUB_OAUTH_CALLBACK_URL'),
      },
      { headers: { Accept: 'application/json' } },
    );

    const accessToken = tokenRes.data?.access_token;
    if (!accessToken) {
      throw new UnauthorizedException('ไม่สามารถรับ access token จาก GitHub ได้');
    }

    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${accessToken}` },
    });
    const ghUser = userRes.data;
    const scopes = (tokenRes.data?.scope ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    const encrypted = encrypt(accessToken);
    const existing = await this.tokenRepo.findOne({ where: { userId: payload.userId, provider: 'oauth' } });

    if (existing) {
      await this.tokenRepo.update(existing.id, {
        tokenEncrypted: encrypted,
        label: `GitHub (@${ghUser.login})`,
        githubLogin: ghUser.login,
        githubUserId: ghUser.id,
        scopes,
        isActive: true,
      });
    } else {
      await this.tokenRepo.save(
        this.tokenRepo.create({
          userId: payload.userId,
          label: `GitHub (@${ghUser.login})`,
          tokenEncrypted: encrypted,
          provider: 'oauth',
          githubLogin: ghUser.login,
          githubUserId: ghUser.id,
          scopes,
          isActive: true,
        }),
      );
    }

    return { userId: payload.userId, githubLogin: ghUser.login };
  }
}
