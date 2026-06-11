import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { UserSettings } from './entities/user-settings.entity';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { UpdateUserSettingsDto } from './dto/update-user-settings.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserSettings)
    private readonly settingsRepo: Repository<UserSettings>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email AND u.isActive = true', { email })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id, isActive: true } });
  }

  private findByIdWithPassword(id: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id AND u.isActive = true', { id })
      .getOne();
  }

  toProfile(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async getProfile(userId: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return this.toProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    user.name = dto.name.trim();
    const saved = await this.userRepo.save(user);
    return this.toProfile(saved);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน');
    }
    const user = await this.findByIdWithPassword(userId);
    if (!user) throw new NotFoundException('User not found');

    const hash = user.passwordHash.replace(/^\$2a\$/, '$2b$');
    const isValid = await bcrypt.compare(dto.currentPassword, hash);
    if (!isValid) throw new UnauthorizedException('รหัสผ่านปัจจุบันไม่ถูกต้อง');

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);
    return { success: true };
  }

  async getUserSettings(userId: string): Promise<UserSettings> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    let settings = await this.settingsRepo.findOne({ where: { userId } });
    if (!settings) {
      settings = this.settingsRepo.create({ userId });
      settings = await this.settingsRepo.save(settings);
    }
    return settings;
  }

  async updateUserSettings(userId: string, dto: UpdateUserSettingsDto): Promise<UserSettings> {
    const settings = await this.getUserSettings(userId);
    Object.assign(settings, dto);
    return this.settingsRepo.save(settings);
  }
}
