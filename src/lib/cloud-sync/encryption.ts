/**
 * Cloud Sync Encryption Module
 *
 * Provides end-to-end encryption for sync payloads using:
 * - AES-256-GCM for encryption
 * - Auto-generated 256-bit key from SYNC_ENCRYPTION_KEY env var
 * - Gzip compression to reduce payload size
 *
 * Blob format:
 * - Bytes 0-3:   Magic number (0x464F5331 = "FOS1")
 * - Bytes 4-5:   Version (uint16, currently 1)
 * - Bytes 6-7:   Flags (uint16, bit 0 = gzip compressed)
 * - Bytes 8-39:  Reserved (32 bytes, zero-filled for format compatibility)
 * - Bytes 40-51: IV/Nonce (12 bytes)
 * - Bytes 52+:   Ciphertext + Auth Tag
 */

import pako from 'pako';
import type { SyncPayload } from './types';

const MAGIC = new Uint8Array([0x46, 0x4f, 0x53, 0x31]); // "FOS1"
const VERSION = 1;
const FLAG_GZIP = 0x0001;

// Header offsets
const OFFSET_MAGIC = 0;
const OFFSET_VERSION = 4;
const OFFSET_FLAGS = 6;
const OFFSET_RESERVED = 8;
const OFFSET_IV = 40;
const OFFSET_CIPHERTEXT = 52;

const RESERVED_LENGTH = 32;
const IV_LENGTH = 12;

export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_FORMAT'
      | 'WRONG_KEY'
      | 'MISSING_KEY'
      | 'CORRUPTED'
      | 'UNSUPPORTED_VERSION'
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Generate a random 256-bit encryption key as a base64 string.
 * Use this to create a SYNC_ENCRYPTION_KEY for your .env file.
 */
export function generateEncryptionKey(): string {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  // Convert to base64
  const binary = String.fromCharCode(...key);
  return btoa(binary);
}

/**
 * Import the encryption key from the SYNC_ENCRYPTION_KEY env var
 */
export async function getEncryptionKey(): Promise<CryptoKey> {
  const keyBase64 = process.env.SYNC_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new EncryptionError(
      'SYNC_ENCRYPTION_KEY not configured. Add a base64-encoded 256-bit key to your .env file.',
      'MISSING_KEY'
    );
  }

  // Decode base64 to bytes
  const binary = atob(keyBase64);
  const keyBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    keyBytes[i] = binary.charCodeAt(i);
  }

  if (keyBytes.length !== 32) {
    throw new EncryptionError(
      `SYNC_ENCRYPTION_KEY must be exactly 32 bytes (256 bits), got ${keyBytes.length}`,
      'MISSING_KEY'
    );
  }

  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypt a sync payload with gzip compression and AES-256-GCM
 */
export async function encrypt(payload: SyncPayload): Promise<ArrayBuffer> {
  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Get encryption key from env
  const key = await getEncryptionKey();

  // Serialize and compress
  const encoder = new TextEncoder();
  const json = encoder.encode(JSON.stringify(payload));
  const compressed = pako.gzip(json);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressed);

  // Assemble blob: magic + version + flags + reserved + iv + ciphertext
  const blob = new Uint8Array(OFFSET_CIPHERTEXT + ciphertext.byteLength);

  // Magic number
  blob.set(MAGIC, OFFSET_MAGIC);

  // Version (little-endian uint16)
  blob[OFFSET_VERSION] = VERSION & 0xff;
  blob[OFFSET_VERSION + 1] = (VERSION >> 8) & 0xff;

  // Flags (little-endian uint16)
  blob[OFFSET_FLAGS] = FLAG_GZIP & 0xff;
  blob[OFFSET_FLAGS + 1] = (FLAG_GZIP >> 8) & 0xff;

  // Reserved (zero-filled for format compatibility)
  blob.fill(0, OFFSET_RESERVED, OFFSET_RESERVED + RESERVED_LENGTH);

  // IV
  blob.set(iv, OFFSET_IV);

  // Ciphertext
  blob.set(new Uint8Array(ciphertext), OFFSET_CIPHERTEXT);

  return blob.buffer;
}

/**
 * Decrypt a sync payload blob
 */
export async function decrypt(blob: ArrayBuffer): Promise<SyncPayload> {
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

  // Extract IV and ciphertext
  const iv = bytes.slice(OFFSET_IV, OFFSET_IV + IV_LENGTH);
  const ciphertext = bytes.slice(OFFSET_CIPHERTEXT);

  // Get key and decrypt
  const key = await getEncryptionKey();

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    throw new EncryptionError('Decryption failed — wrong key or corrupted data', 'WRONG_KEY');
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
