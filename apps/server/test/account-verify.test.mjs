import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccountConfig, classifySmtpError } from '../src/account-verify.mjs';
import { createAccountManager } from '../src/managed-accounts.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config = {
  imap: { host: 'h', port: 993, user: 'a@x.at', password: 'p' },
  smtp: { host: 'h', port: 587, user: 'a@x.at', password: 'p' }
};
const imapOk = () => ({ connect: async () => {}, logout: async () => {}, close() {} });
const smtpOk = () => ({ verify: async () => true, close() {} });

test('Login check reports IMAP and SMTP errors separately', async () => {
  assert.deepEqual(await verifyAccountConfig(config, { imapFactory: imapOk, smtpFactory: smtpOk }), { ok: true });
  await assert.rejects(
    verifyAccountConfig(config, {
      imapFactory: () => ({
        connect: async () => {
          throw Object.assign(new Error('x'), { authenticationFailed: true });
        },
        logout: async () => {},
        close() {}
      }),
      smtpFactory: smtpOk
    }),
    e => e.field === 'imap' && e.code === 'imap_auth_failed' && e.retryable === false
  );
  await assert.rejects(
    verifyAccountConfig(config, {
      imapFactory: imapOk,
      smtpFactory: () => ({
        verify: async () => {
          throw Object.assign(new Error('x'), { code: 'EAUTH' });
        },
        close() {}
      })
    }),
    e => e.field === 'smtp' && e.code === 'smtp_auth_failed'
  );
  assert.equal(classifySmtpError({ code: 'ETIMEDOUT' }).retryable, true);
  assert.equal(classifySmtpError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }).code, 'smtp_tls_failed');
});

function vault() {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`),
    m
  };
}
const input = {
  label: 'Peter',
  user: 'peter@example.org',
  password: 'geheim',
  imapHost: 'mail.example.org',
  smtpHost: 'mail.example.org'
};

test('Account is saved only after a successful check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-verify-'));
  try {
    const v = vault();
    let calls = 0;
    const manager = await createAccountManager({
      env: {},
      filename: join(dir, 'a.json'),
      vault: v,
      verify: async () => {
        calls++;
        throw Object.assign(new Error('falsch'), { statusCode: 422, retryable: false });
      }
    });
    await assert.rejects(manager.create(input), /falsch/);
    assert.equal(v.m.size, 0, 'nothing in the keychain');
    assert.equal(manager.all().length, 0);
    await assert.rejects(
      manager.create({ ...input, allowUnverified: true }),
      /falsch/,
      'password errors cannot be skipped'
    );
    assert.equal(calls, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Network errors may be explicitly skipped; password stays out of the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-verify-'));
  try {
    const manager = await createAccountManager({
      env: {},
      filename: join(dir, 'a.json'),
      vault: vault(),
      verify: async () => {
        throw Object.assign(new Error('offline'), { statusCode: 422, retryable: true });
      }
    });
    await assert.rejects(manager.create(input), /offline/);
    const created = await manager.create({ ...input, allowUnverified: true });
    assert.equal(created.verified, false);
    assert.ok(!readFileSync(join(dir, 'a.json'), 'utf8').includes('geheim'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Changing only the signature does not trigger a new check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-verify-'));
  try {
    let calls = 0;
    const manager = await createAccountManager({
      env: {},
      filename: join(dir, 'a.json'),
      vault: vault(),
      verify: async () => {
        calls++;
      }
    });
    const created = await manager.create(input);
    await manager.update(created.id, { signature: 'LG Peter' });
    assert.equal(calls, 1);
    await manager.update(created.id, { password: 'neu' });
    assert.equal(calls, 2);
    await manager.verifyInput({ id: created.id, ...input, password: '' });
    assert.equal(calls, 3, 'test with stored password');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
