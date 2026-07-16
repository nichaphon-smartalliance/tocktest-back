import * as crypto from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';

const ALGORITHM = 'aes-256-gcm';
const LEGACY_ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 12;
const LEGACY_IV_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new InternalServerErrorException('Encryption service misconfigured');
  }
  return Buffer.from(key, 'hex');
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `v2:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(encrypted: string): string {
  if (encrypted.startsWith('v2:')) {
    const [, ivHex, tagHex, encryptedHex] = encrypted.split(':');
    if (!ivHex || !tagHex || encryptedHex === undefined) {
      throw new InternalServerErrorException('Invalid encrypted token format');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  const colonIdx = encrypted.indexOf(':');
  if (colonIdx === -1) {
    throw new InternalServerErrorException('Invalid encrypted token format');
  }
  const ivHex = encrypted.slice(0, colonIdx);
  const encryptedHex = encrypted.slice(colonIdx + 1);
  if (!ivHex || !encryptedHex) {
    throw new InternalServerErrorException('Invalid encrypted token format');
  }
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== LEGACY_IV_LENGTH) {
    throw new InternalServerErrorException('Invalid encrypted token format');
  }
  const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
