import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

const mockUser = { id: 'u1', email: 'test@example.com', role: 'user', sessionVersion: 1 };

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;
  let usersService: { findById: jest.Mock };

  beforeEach(async () => {
    usersService = { findById: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UsersService, useValue: usersService },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test-secret-key') },
        },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it('returns the user when payload is valid', async () => {
    usersService.findById.mockResolvedValue(mockUser);
    const result = await strategy.validate({ sub: 'u1', email: 'test@example.com', role: 'user', sv: 1 });
    expect(result).toBe(mockUser);
  });

  it('throws UnauthorizedException when user is not found', async () => {
    usersService.findById.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'missing', email: '', role: '', sv: 0 })).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when session version does not match', async () => {
    usersService.findById.mockResolvedValue({ ...mockUser, sessionVersion: 2 });
    await expect(strategy.validate({ sub: 'u1', email: '', role: '', sv: 1 })).rejects.toThrow(UnauthorizedException);
  });

  it('accepts when sv is undefined and sessionVersion is 0', async () => {
    usersService.findById.mockResolvedValue({ ...mockUser, sessionVersion: 0 });
    const result = await strategy.validate({ sub: 'u1', email: '', role: '' }); // sv omitted
    expect(result).toBeDefined();
  });

  it('rejects when sv is undefined but sessionVersion is non-zero', async () => {
    usersService.findById.mockResolvedValue({ ...mockUser, sessionVersion: 1 });
    await expect(strategy.validate({ sub: 'u1', email: '', role: '' })).rejects.toThrow(UnauthorizedException);
  });

  // Regression: JWT_SECRET also signs OAuth/App-install *state* tokens whose
  // payload carries `userId`, not `sub`. Such a token must never authenticate a
  // session — and must never reach findById() with an empty id, which TypeORM
  // would drop from the WHERE clause and match an arbitrary active user.
  it.each([
    ['sub missing (state token shape)', { userId: 'victim', purpose: 'github-oauth' }],
    ['sub empty string', { sub: '', email: '', role: '' }],
    ['sub non-string', { sub: 123 as unknown as string, email: '', role: '' }],
  ])('rejects a token without a valid subject: %s', async (_label, payload) => {
    await expect(strategy.validate(payload as never)).rejects.toThrow(UnauthorizedException);
    expect(usersService.findById).not.toHaveBeenCalled();
  });
});
