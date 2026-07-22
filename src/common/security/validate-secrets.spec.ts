import { validateSecrets } from './validate-secrets';

const STRONG_JWT = 'a'.repeat(40);
const STRONG_KEY = 'b'.repeat(64);

describe('validateSecrets', () => {
  it('passes with strong secrets', () => {
    expect(() =>
      validateSecrets({ NODE_ENV: 'production', JWT_SECRET: STRONG_JWT, ENCRYPTION_KEY: STRONG_KEY } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('throws in production when JWT_SECRET is a shipped placeholder', () => {
    expect(() =>
      validateSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'tocktest-jwt-secret-change-in-production-min-32-chars',
        ENCRYPTION_KEY: STRONG_KEY,
      } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/);
  });

  it('throws in production when JWT_SECRET is too short', () => {
    expect(() =>
      validateSecrets({ NODE_ENV: 'production', JWT_SECRET: 'short', ENCRYPTION_KEY: STRONG_KEY } as NodeJS.ProcessEnv),
    ).toThrow(/too short/);
  });

  it('throws in production when a secret is missing', () => {
    expect(() =>
      validateSecrets({ NODE_ENV: 'production', ENCRYPTION_KEY: STRONG_KEY } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_SECRET is not set/);
  });

  it('warns but does not throw in development', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      validateSecrets({
        NODE_ENV: 'development',
        JWT_SECRET: 'your-secret-key-change-in-production',
        ENCRYPTION_KEY: STRONG_KEY,
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
