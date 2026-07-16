import * as crypto from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';
import { encrypt, decrypt } from './encryption.util';

const VALID_KEY = 'a'.repeat(64);

beforeEach(() => {
  process.env.ENCRYPTION_KEY = VALID_KEY;
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
});

describe('encrypt', () => {
  it('returns a string with the v2: prefix', () => {
    const result = encrypt('hello');
    expect(result.startsWith('v2:')).toBe(true);
  });

  it('returns four colon-separated segments (v2:iv:tag:data)', () => {
    const parts = encrypt('hello').split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v2');
    expect(parts[1].length).toBeGreaterThan(0);
    expect(parts[2].length).toBeGreaterThan(0);
    expect(parts[3].length).toBeGreaterThan(0);
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    const a = encrypt('hello');
    const b = encrypt('hello');
    expect(a).not.toBe(b);
  });

  it('throws InternalServerErrorException when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('hello')).toThrow(InternalServerErrorException);
  });

  it('throws when ENCRYPTION_KEY is too short', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(62);
    expect(() => encrypt('hello')).toThrow(InternalServerErrorException);
  });

  it('throws when ENCRYPTION_KEY is too long', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(66);
    expect(() => encrypt('hello')).toThrow(InternalServerErrorException);
  });
});

describe('decrypt', () => {
  it('round-trips a normal string', () => {
    expect(decrypt(encrypt('hello world'))).toBe('hello world');
  });

  it('round-trips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('round-trips a multi-byte unicode string', () => {
    const text = 'สวัสดี 中文 🎉';
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it('throws for a v2: token with missing segments', () => {
    expect(() => decrypt('v2:onlyone')).toThrow(InternalServerErrorException);
  });

  it('throws for legacy format with no colon', () => {
    expect(() => decrypt('nodcolon')).toThrow(InternalServerErrorException);
  });

  it('throws when legacy IV is wrong length', () => {
    // 3-byte IV (6 hex chars) is not 16 bytes
    expect(() => decrypt('aabbcc:deadbeef')).toThrow(InternalServerErrorException);
  });

  it('decrypts a legacy CBC ciphertext', () => {
    const key = Buffer.from(VALID_KEY, 'hex');
    const iv = Buffer.alloc(16); // known deterministic IV
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let enc = cipher.update('legacy-secret', 'utf8', 'hex');
    enc += cipher.final('hex');
    const legacyToken = `${iv.toString('hex')}:${enc}`;

    expect(decrypt(legacyToken)).toBe('legacy-secret');
  });

  it('throws InternalServerErrorException when key is missing during decrypt', () => {
    const token = encrypt('data');
    delete process.env.ENCRYPTION_KEY;
    expect(() => decrypt(token)).toThrow(InternalServerErrorException);
  });
});
