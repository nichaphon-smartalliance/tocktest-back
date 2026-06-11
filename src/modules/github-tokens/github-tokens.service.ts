import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GithubToken } from './entities/github-token.entity';
import { encrypt, decrypt } from '../../common/utils/encryption.util';
import type { CreateGithubTokenDto } from './dto/create-github-token.dto';

@Injectable()
export class GithubTokensService {
  constructor(
    @InjectRepository(GithubToken)
    private readonly tokenRepo: Repository<GithubToken>,
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
}
