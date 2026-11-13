// Check native OS credential store without touching any real account.
import { randomBytes } from 'node:crypto';
import { openSystemVault } from '../apps/server/src/managed-accounts.mjs';
if (process.platform !== 'win32') {
  console.error('This test is for Windows only.');
  process.exit(1);
}
const vault = await openSystemVault();
if (!vault.available) {
  console.error('Windows credential store not available; check the native @napi-rs/keyring package.');
  process.exit(1);
}
const id = `managed-${randomBytes(6).toString('hex')}`;
const secret = randomBytes(18).toString('hex');
try {
  vault.set(id, 'imap', secret);
  if (vault.get(id, 'imap') !== secret)
    throw new Error('Windows credential store does not return the test value correctly.');
  console.log(`Credential Manager (${process.arch}): writing and reading a temporary test entry succeeded.`);
} finally {
  try {
    vault.delete(id, 'imap');
  } catch {
    console.warn('Test entry could not be removed – check the name in Credential Manager:', id);
  }
}
