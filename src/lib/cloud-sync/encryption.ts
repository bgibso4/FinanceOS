/**
 * Cloud Sync Encryption Module
 *
 * Provides end-to-end encryption for sync payloads using:
 * - PBKDF2 for key derivation (100,000 iterations)
 * - AES-256-GCM for encryption
 * - Gzip compression to reduce payload size
 *
 * Blob format:
 * - Bytes 0-3:   Magic number (0x464F5331 = "FOS1")
 * - Bytes 4-5:   Version (uint16, currently 1)
 * - Bytes 6-7:   Flags (uint16, bit 0 = gzip compressed)
 * - Bytes 8-39:  Salt (32 bytes)
 * - Bytes 40-51: IV/Nonce (12 bytes)
 * - Bytes 52+:   Ciphertext + Auth Tag
 */

import pako from 'pako';
import type { SyncPayload } from './types';

const MAGIC = new Uint8Array([0x46, 0x4f, 0x53, 0x31]); // "FOS1"
const VERSION = 1;
const FLAG_GZIP = 0x0001;
const PBKDF2_ITERATIONS = 100_000;

// Header offsets
const OFFSET_MAGIC = 0;
const OFFSET_VERSION = 4;
const OFFSET_FLAGS = 6;
const OFFSET_SALT = 8;
const OFFSET_IV = 40;
const OFFSET_CIPHERTEXT = 52;

const SALT_LENGTH = 32;
const IV_LENGTH = 12;

export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_FORMAT'
      | 'WRONG_PASSPHRASE'
      | 'CORRUPTED'
      | 'UNSUPPORTED_VERSION'
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Derive an AES-256 key from a passphrase using PBKDF2
 */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Hash a passphrase for local storage (to validate user input without storing passphrase)
 * Uses SHA-256 with a fixed salt prefix
 */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`financeos-sync:${passphrase}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypt a sync payload with gzip compression and AES-256-GCM
 */
export async function encrypt(payload: SyncPayload, passphrase: string): Promise<ArrayBuffer> {
  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Derive encryption key
  const key = await deriveKey(passphrase, salt);

  // Serialize and compress
  const encoder = new TextEncoder();
  const json = encoder.encode(JSON.stringify(payload));
  const compressed = pako.gzip(json);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressed);

  // Assemble blob: magic + version + flags + salt + iv + ciphertext
  const blob = new Uint8Array(OFFSET_CIPHERTEXT + ciphertext.byteLength);

  // Magic number
  blob.set(MAGIC, OFFSET_MAGIC);

  // Version (little-endian uint16)
  blob[OFFSET_VERSION] = VERSION & 0xff;
  blob[OFFSET_VERSION + 1] = (VERSION >> 8) & 0xff;

  // Flags (little-endian uint16)
  blob[OFFSET_FLAGS] = FLAG_GZIP & 0xff;
  blob[OFFSET_FLAGS + 1] = (FLAG_GZIP >> 8) & 0xff;

  // Salt
  blob.set(salt, OFFSET_SALT);

  // IV
  blob.set(iv, OFFSET_IV);

  // Ciphertext
  blob.set(new Uint8Array(ciphertext), OFFSET_CIPHERTEXT);

  return blob.buffer;
}

/**
 * Decrypt a sync payload blob
 */
export async function decrypt(blob: ArrayBuffer, passphrase: string): Promise<SyncPayload> {
  const bytes = new Uint8Array(blob);

  // Validate minimum size
  if (bytes.length < OFFSET_CIPHERTEXT + 16) {
    // At least header + auth tag
    throw new EncryptionError('Invalid sync file: too small', 'INVALID_FORMAT');
  }

  // Validate magic number
  if (
    bytes[0] !== MAGIC[0] ||
    bytes[1] !== MAGIC[1] ||
    bytes[2] !== MAGIC[2] ||
    bytes[3] !== MAGIC[3]
  ) {
    throw new EncryptionError('Invalid sync file format', 'INVALID_FORMAT');
  }

  // Read version
  const version = bytes[OFFSET_VERSION] | (bytes[OFFSET_VERSION + 1] << 8);
  if (version !== VERSION) {
    throw new EncryptionError(`Unsupported sync version: ${version}`, 'UNSUPPORTED_VERSION');
  }

  // Read flags
  const flags = bytes[OFFSET_FLAGS] | (bytes[OFFSET_FLAGS + 1] << 8);
  const isGzipped = (flags & FLAG_GZIP) !== 0;

  // Extract components
  const salt = bytes.slice(OFFSET_SALT, OFFSET_SALT + SALT_LENGTH);
  const iv = bytes.slice(OFFSET_IV, OFFSET_IV + IV_LENGTH);
  const ciphertext = bytes.slice(OFFSET_CIPHERTEXT);

  // Derive key and decrypt
  const key = await deriveKey(passphrase, salt);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    throw new EncryptionError('Incorrect passphrase or corrupted data', 'WRONG_PASSPHRASE');
  }

  // Decompress if needed
  const decoder = new TextDecoder();
  let jsonString: string;

  if (isGzipped) {
    try {
      const decompressed = pako.ungzip(new Uint8Array(plaintext));
      jsonString = decoder.decode(decompressed);
    } catch {
      throw new EncryptionError('Failed to decompress data', 'CORRUPTED');
    }
  } else {
    jsonString = decoder.decode(plaintext);
  }

  // Parse JSON
  try {
    return JSON.parse(jsonString) as SyncPayload;
  } catch {
    throw new EncryptionError('Invalid payload format', 'CORRUPTED');
  }
}

/**
 * Validate that a blob can be decrypted with the given passphrase
 * (without fully parsing the payload)
 */
export async function validatePassphrase(blob: ArrayBuffer, passphrase: string): Promise<boolean> {
  try {
    await decrypt(blob, passphrase);
    return true;
  } catch (error) {
    if (error instanceof EncryptionError && error.code === 'WRONG_PASSPHRASE') {
      return false;
    }
    throw error;
  }
}
