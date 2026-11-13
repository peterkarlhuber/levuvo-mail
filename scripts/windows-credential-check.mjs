// Check native OS credential store without touching any real account.
import { randomBytes } from 'node:crypto';
import { openSystemVault } from '../apps/server/src/managed-accounts.mjs';
if (process.platform !== 'win32') {
  console.error('Dieser Test ist ausschließlich für Windows.');
  process.exit(1);
}
const vault = await openSystemVault();
if (!vault.available) {
  console.error('Windows-Anmeldedatenspeicher nicht verfügbar; natives @napi-rs/keyring-Paket prüfen.');
  process.exit(1);
}
const id = `managed-${randomBytes(6).toString('hex')}`;
const secret = randomBytes(18).toString('hex');
try {
  vault.set(id, 'imap', secret);
  if (vault.get(id, 'imap') !== secret)
    throw new Error('Windows-Anmeldedatenspeicher gibt den Testwert nicht korrekt zurück.');
  console.log(`Credential Manager (${process.arch}): Schreiben und Lesen einer temporären Testkennung erfolgreich.`);
} finally {
  try {
    vault.delete(id, 'imap');
  } catch {
    console.warn('Testeintrag konnte nicht entfernt werden – Namen im Credential Manager prüfen:', id);
  }
}
