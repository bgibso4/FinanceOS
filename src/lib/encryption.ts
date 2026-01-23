import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.PLAID_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('PLAID_ENCRYPTION_KEY must be at least 32 characters');
  }
  return crypto.scryptSync(key, 'financeos-plaid-salt', KEY_LENGTH);
}

export function encryptAccessToken(accessToken: string): { encrypted: string; iv: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(accessToken, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();
  encrypted += ':' + authTag.toString('base64');

  return {
    encrypted,
    iv: iv.toString('base64'),
  };
}

export function decryptAccessToken(encrypted: string, iv: string): string {
  const key = getEncryptionKey();
  const ivBuffer = Buffer.from(iv, 'base64');

  const [encryptedData, authTagBase64] = encrypted.split(':');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
