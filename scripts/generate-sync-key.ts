#!/usr/bin/env npx tsx
/**
 * Generate a SYNC_ENCRYPTION_KEY for your .env file.
 *
 * Usage: npx tsx scripts/generate-sync-key.ts
 */

const key = new Uint8Array(32);
crypto.getRandomValues(key);
const base64 = Buffer.from(key).toString('base64');

console.log(`\nAdd this to your .env file:\n`);
console.log(`SYNC_ENCRYPTION_KEY=${base64}`);
console.log(`\nKeep this key safe — you'll need it to sync to other devices.\n`);
