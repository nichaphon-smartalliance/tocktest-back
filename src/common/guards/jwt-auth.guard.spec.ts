import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

function buildContext(isPublicValue: boolean | undefined) {
  const mockHandler = jest.fn();
  const mockClass = jest.fn();
  return {
    getHandler: () => mockHandler,
    getClass: () => mockClass,
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
    }),
  } as any;
}

describe('JwtAuthGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    guard = new JwtAuthGuard(reflector);
  });

  describe('canActivate', () => {
    it('returns true immediately for @Public() routes without calling passport', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const spy = jest.spyOn(AuthGuard('jwt').prototype, 'canActivate').mockResolvedValue(true as any);

      const result = await guard.canActivate(buildContext(true));

      expect(result).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('checks IS_PUBLIC_KEY with handler and class', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const ctx = buildContext(true);
      guard.canActivate(ctx);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    });

    it('delegates to passport for non-public routes', async () => {
      reflector.getAllAndOverride.mockReturnValue(false);
      const spy = jest.spyOn(AuthGuard('jwt').prototype, 'canActivate').mockResolvedValue(true as any);

      await guard.canActivate(buildContext(false));

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('handleRequest', () => {
    it('returns the user when no error and user is present', () => {
      const mockUser = { id: '1', email: 'a@b.com' };
      expect(guard.handleRequest(null, mockUser)).toBe(mockUser);
    });

    it('throws UnauthorizedException with Thai message when user is falsy', () => {
      expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
      expect(() => guard.handleRequest(null, null)).toThrow('กรุณาเข้าสู่ระบบก่อน');
    });

    it('throws UnauthorizedException when user is undefined', () => {
      expect(() => guard.handleRequest(null, undefined)).toThrow(UnauthorizedException);
    });

    it('re-throws the provided error when err is set', () => {
      const customError = new UnauthorizedException('Custom message');
      expect(() => guard.handleRequest(customError, null)).toThrow(customError);
    });
  });
});
