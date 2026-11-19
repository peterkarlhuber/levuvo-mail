// Regression tests for the MCP findings of the internal audit of 19 November 2026:
// API-LEV-008 (calendar ranges), AIS-LEV-008 (lasting AI label of what agents create).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentRegistry, createApprovals, createMcpHandler } from '../src/mcp-server.mjs';
import { agentOrigin, contactPayload, eventPayload } from '../src/ai-payloads.mjs';
import { composeDraft, parseAiGenerated, validateDraft } from '../src/drafts.mjs';
import { createJsonFile } from '../src/app.mjs';

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-mcpa-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const ctx = {
    accounts: () => [{ id: 'a1', label: 'Work', imap: { user: 'me@example.com' } }],
    async internalRequest(method, url, body, action) {
      calls.push({ method, url, body, action });
      if (url.startsWith('/api/calendar/events?')) return { events: [] };
      if (url.startsWith('/api/drafts/save')) return { folder: 'Drafts', uid: 9 };
      return { ok: true };
    }
  };
  const log = { add: () => Promise.resolve() };
  const agents = createAgentRegistry(await createJsonFile(join(dir, 'mcp.json'), { agents: [] }));
  const approvals = createApprovals(await createJsonFile(join(dir, 'ap.json'), { items: [] }), {
    execute: async () => ({ done: true }),
    log
  });
  ctx.approvals = approvals;
  ctx.executeApproved = async () => ({});
  const handle = createMcpHandler(ctx, { approvals, log, version: '1' });
  return { calls, agents, handle };
}
const call = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

test('API-LEV-008: a too long or invalid range is an error, not "no free time"', async t => {
  const { agents, handle, calls } = await setup(t);
  const { agent } = await agents.create({ name: 'Planer', level: 'read' });
  for (const tool of ['find_free_time', 'list_events']) {
    const long = await handle(agent, call(tool, { from: '2026-11-01', to: '2027-03-01', minutes: 30 }));
    assert.equal(long.result.isError, true, tool);
    assert.match(long.result.content[0].text, /62 days/);
    const bad = await handle(agent, call(tool, { from: 'next week', to: '2026-12-01' }));
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /ISO dates/);
  }
  assert.equal(calls.length, 0, 'nothing is read for an invalid range');
  const ok = await handle(agent, call('find_free_time', { from: '2026-11-23T08:00', to: '2026-11-24T18:00' }));
  assert.ok(!ok.result.isError);
  assert.ok(JSON.parse(ok.result.content[0].text).length > 0);
  const list = await handle(agent, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const free = list.result.tools.find(x => x.name === 'find_free_time');
  assert.match(free.description, /62 days/);
  assert.match(free.inputSchema.properties.from.description, /YYYY-MM-DD/);
});

test('AIS-LEV-008: drafts, events and contacts an agent creates keep an AI label', async t => {
  const { agents, handle, calls } = await setup(t);
  const { agent } = await agents.create({ name: 'Büro-Agent', level: 'organize' });
  await handle(agent, call('create_draft', { to: ['a@example.com'], subject: 'Re', body: 'Hallo' }));
  const draft = calls.find(c => c.url.startsWith('/api/drafts/save'));
  assert.equal(draft.body.aiGenerated, 'KI-erstellt / AI-generated (Levuvo Mail, Agent: Büro-Agent)');
  await handle(agent, call('create_event', { summary: 'Call', start: '2026-11-20T10:00', end: '2026-11-20T11:00' }));
  const event = calls.find(c => c.url === '/api/calendar/events/save');
  assert.match(event.body.event.description, /AI-generated \(Levuvo Mail, Agent: Büro-Agent\)$/);
  await handle(agent, call('create_contact', { name: 'Anna', note: 'Lieferantin' }));
  const contact = calls.find(c => c.url === '/api/contacts/save');
  assert.match(contact.body.contact.note, /^Lieferantin\n\n— KI-erstellt/);
  // What the user applies from a suggestion themselves carries no agent label.
  assert.equal(
    eventPayload({ summary: 'x', start: '2026-11-20', end: '2026-11-21', allDay: true }).event.description,
    ''
  );
  assert.equal(contactPayload({ name: 'x' }).contact.note, '');
  // Limits hold with the label.
  assert.equal(
    eventPayload({ description: 'x'.repeat(5000) }, { origin: agentOrigin(agent) }).event.description.length,
    4000
  );
  assert.equal(
    agentOrigin({ name: 'a\r\nBcc: evil@x' }),
    'KI-erstellt / AI-generated (Levuvo Mail, Agent: aBcc evil@x)'
  );
});

test('AIS-LEV-008: the AI label is a header of the stored draft and is read back', async () => {
  const input = {
    draftId: '6f1d3a4e-2b7c-4d8e-9f00-112233445566',
    to: ['a@example.com'],
    cc: [],
    bcc: [],
    subject: 'Re',
    text: 'Hallo',
    previousUid: null,
    aiGenerated: 'KI-erstellt / AI-generated (Levuvo Mail, Agent: Büro-Agent)'
  };
  const raw = await composeDraft('me@example.com', validateDraft(input));
  assert.match(raw.toString('latin1'), /^X-Levuvo-AI-Generated: /im);
  assert.equal(parseAiGenerated(raw), input.aiGenerated);
  const plain = await composeDraft('me@example.com', validateDraft({ ...input, aiGenerated: undefined }));
  assert.equal(parseAiGenerated(plain), null);
  assert.throws(() => validateDraft({ ...input, aiGenerated: 'x\r\nBcc: evil@example.com' }), /KI-Kennzeichnung/);
});

test('ARC-LEV-008: built-in approval types live in the shared registry like added ones', async () => {
  const { createToolRegistry } = await import('../src/mcp-server.mjs');
  const calls = [];
  const registry = createToolRegistry({ call: async (...args) => calls.push(args) && { ok: true } });
  for (const type of ['send', 'event', 'contact', 'trash']) assert.ok(registry.approval(type), type);
  assert.throws(() => registry.registerApproval('send', { summary: () => ({}), execute: async () => ({}) }));
  await registry.approval('trash').execute({ account: 'a1', folder: 'INBOX', uid: 4 });
  assert.deepEqual(calls[0], [
    'POST',
    '/api/messages/4/action?account=a1',
    { folder: 'INBOX', action: 'trash' },
    'mail-v1'
  ]);
  assert.deepEqual(registry.approval('trash').summary({ account: 'a1', folder: 'INBOX', uid: 4 }), {
    account: 'a1',
    folder: 'INBOX',
    uid: 4
  });
  // A registry without the app's API cannot execute anything.
  assert.throws(() => createToolRegistry().approval('send').execute({}), /Unbekannte Freigabe/);
});
