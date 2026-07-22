import { Test } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserSettings } from './entities/user-settings.entity';

const baseUser = (overrides = {}): User =>
  ({
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
    passwordHash: null,
    githubId: null,
    githubLogin: null,
    authProvider: 'local',
    avatarUrl: null,
    role: 'user',
    isActive: true,
    sessionVersion: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }) as User;

function makeQueryBuilder(result: unknown) {
  const qb: any = {
    addSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    getOne: jest.fn().mockResolvedValue(result),
  };
  return qb;
}

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let settingsRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      createQueryBuilder: jest.fn(() => makeQueryBuilder(null)),
    };
    settingsRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserSettings), useValue: settingsRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  // ── findByEmail / findById ────────────────────────────────────────────────

  describe('findByEmail', () => {
    it('queries via query builder, selecting the passwordHash and only active users', async () => {
      const qb = makeQueryBuilder(baseUser());
      userRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findByEmail('alice@example.com');

      expect(qb.addSelect).toHaveBeenCalledWith('u.passwordHash');
      expect(qb.where).toHaveBeenCalledWith('u.email = :email AND u.isActive = true', { email: 'alice@example.com' });
      expect(result).toMatchObject({ email: 'alice@example.com' });
    });

    it('returns null when no matching active user exists', async () => {
      userRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(null));
      const result = await service.findByEmail('ghost@example.com');
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('scopes the lookup to id and isActive', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      await service.findById('u1');
      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: 'u1', isActive: true } });
    });

    it('returns null when the user is not found or inactive', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── upsertGithubUser ──────────────────────────────────────────────────────

  describe('upsertGithubUser', () => {
    it('updates an existing user matched by githubId (login + avatar refresh)', async () => {
      const existing = baseUser({ id: 'u1', githubId: 42, githubLogin: 'old-login', authProvider: 'github' });
      userRepo.findOne.mockResolvedValue(existing);

      const result = await service.upsertGithubUser({
        githubId: 42,
        githubLogin: 'new-login',
        avatarUrl: 'https://avatar/new.png',
      });

      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { githubId: 42, isActive: true } });
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ githubLogin: 'new-login', avatarUrl: 'https://avatar/new.png' }),
      );
      expect(result.githubLogin).toBe('new-login');
      expect(userRepo.create).not.toHaveBeenCalled();
    });

    it('links githubId onto an existing email match whose account is not a fresh local/password account', async () => {
      // authProvider 'github' (or a local account that already carries a githubId)
      // skips the "sign in with password first" guard — this covers re-linking
      // an account found by email whose githubId lookup didn't match directly.
      userRepo.findOne
        .mockResolvedValueOnce(null) // no user with this githubId yet
        .mockResolvedValueOnce(baseUser({ id: 'u2', email: 'linked@example.com', authProvider: 'github', passwordHash: null, githubId: 111 }));

      const result = await service.upsertGithubUser({
        githubId: 99,
        githubLogin: 'linked-login',
        email: 'linked@example.com',
      });

      expect(result.githubId).toBe(99);
      expect(result.githubLogin).toBe('linked-login');
      expect(userRepo.create).not.toHaveBeenCalled();
    });

    it('blocks linking when the email belongs to a fresh local account with no githubId (must sign in with password first)', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseUser({ id: 'u4', email: 'freshlocal@example.com', authProvider: 'local', githubId: null }));

      await expect(
        service.upsertGithubUser({ githubId: 55, githubLogin: 'x', email: 'freshlocal@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the matching email belongs to a password-protected local account', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseUser({ id: 'u3', email: 'secure@example.com', authProvider: 'local', passwordHash: 'hash', githubId: null }));

      await expect(
        service.upsertGithubUser({ githubId: 77, githubLogin: 'x', email: 'secure@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('creates a brand new user when no githubId or email match exists', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.upsertGithubUser({
        githubId: 123,
        githubLogin: 'newperson',
        name: 'New Person',
      });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          githubId: 123,
          githubLogin: 'newperson',
          authProvider: 'github',
          role: 'user',
          isActive: true,
        }),
      );
      expect(result.githubLogin).toBe('newperson');
    });

    it('defaults the email to a noreply github address when none is provided on create', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await service.upsertGithubUser({ githubId: 5, githubLogin: 'noemail' });
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'noemail@users.noreply.github.com' }),
      );
    });
  });

  // ── getProfile / updateProfile ────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns a sanitized profile (no passwordHash) for the requesting user', async () => {
      userRepo.findOne.mockResolvedValue(baseUser({ passwordHash: 'secret-hash' }));
      const profile = await service.getProfile('u1');
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile.email).toBe('alice@example.com');
    });

    it('throws NotFoundException for a nonexistent/inactive user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.getProfile('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('throws NotFoundException instead of updating a nonexistent user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.updateProfile('ghost', { name: 'X' })).rejects.toThrow(NotFoundException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('trims and saves the new name, scoped to the requesting userId', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      const profile = await service.updateProfile('u1', { name: '  New Name  ' });
      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: 'u1', isActive: true } });
      expect(profile.name).toBe('New Name');
    });
  });

  // ── changePassword — session-version bump on success ─────────────────────

  describe('changePassword', () => {
    it('rejects when new password equals current password', async () => {
      await expect(
        service.changePassword('u1', { currentPassword: 'same-pass-123', newPassword: 'same-pass-123' }),
      ).rejects.toThrow(BadRequestException);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user has no password set (e.g. github-only account)', async () => {
      const qb = makeQueryBuilder(baseUser({ passwordHash: null }));
      userRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.changePassword('u1', { currentPassword: 'old-password', newPassword: 'brand-new-password' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnauthorizedException when currentPassword is wrong', async () => {
      const hash = await bcrypt.hash('correct-password', 1);
      const qb = makeQueryBuilder(baseUser({ passwordHash: hash }));
      userRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.changePassword('u1', { currentPassword: 'wrong-password', newPassword: 'brand-new-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('updates the password hash and increments sessionVersion (invalidates other sessions) on success', async () => {
      const hash = await bcrypt.hash('correct-password', 1);
      const user = baseUser({ passwordHash: hash, sessionVersion: 1 });
      const qb = makeQueryBuilder(user);
      userRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.changePassword('u1', {
        currentPassword: 'correct-password',
        newPassword: 'brand-new-password',
      });

      expect(result).toEqual({ success: true });
      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ sessionVersion: 2 }));
      const savedUser = userRepo.save.mock.calls[0][0];
      expect(savedUser.passwordHash).not.toBe(hash);
    });

    it('normalizes a legacy $2a$ hash before comparing (pgcrypto compatibility)', async () => {
      const originalHash = await bcrypt.hash('correct-password', 1);
      const legacyHash = originalHash.replace(/^\$2b\$/, '$2a$');
      const qb = makeQueryBuilder(baseUser({ passwordHash: legacyHash }));
      userRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.changePassword('u1', {
        currentPassword: 'correct-password',
        newPassword: 'brand-new-password',
      });
      expect(result).toEqual({ success: true });
    });
  });

  // ── user settings — CRUD + user scoping ──────────────────────────────────

  describe('getUserSettings', () => {
    it('throws NotFoundException for a nonexistent user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.getUserSettings('ghost')).rejects.toThrow(NotFoundException);
    });

    it('scopes the settings lookup to the requesting userId', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      settingsRepo.findOne.mockResolvedValue({ id: 's1', userId: 'u1' });
      await service.getUserSettings('u1');
      expect(settingsRepo.findOne).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });

    it('creates default settings when none exist yet', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      settingsRepo.findOne.mockResolvedValue(null);
      await service.getUserSettings('u1');
      expect(settingsRepo.create).toHaveBeenCalledWith({ userId: 'u1' });
      expect(settingsRepo.save).toHaveBeenCalled();
    });
  });

  describe('updateUserSettings', () => {
    it('denies the update for a nonexistent user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateUserSettings('ghost', { preferredLanguage: 'en' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('merges the dto onto the user\'s own settings and saves it', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      settingsRepo.findOne.mockResolvedValue({ id: 's1', userId: 'u1', preferredLanguage: 'th' });

      const result = await service.updateUserSettings('u1', { preferredLanguage: 'en' });

      expect(result.preferredLanguage).toBe('en');
      expect(settingsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', preferredLanguage: 'en' }));
    });
  });
});
