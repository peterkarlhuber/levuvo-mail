// Management of the MCP server (agents, tokens, approvals) for the settings and the assistant panel.
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  DEFAULT_MCP_PORT,
  LEVELS,
  createAgentRegistry,
  createApprovals,
  createMcpHandler,
  createMcpHttpServer,
  hashToken,
  mcpToolRegistry
} from './mcp-server.mjs';
import { resolveSidecar } from './ai-sidecar.mjs';

const ACTION = 'ai-v1';
const q = s => encodeURIComponent(String(s));

export async function setupMcp(ctx, { createJsonFile, dir }) {
  const file = await createJsonFile(path.join(dir, 'mcp.json'), { enabled: false, port: DEFAULT_MCP_PORT, agents: [] });
  const approvalsFile = await createJsonFile(path.join(dir, 'mcp-approvals.json'), { items: [] });
  const persistent = createAgentRegistry(file);
  // Short-lived agents of the built-in assistant (routines, delegated tasks): in memory only.
  const ephemeral = new Map();
  const agents = {
    ...persistent,
    byToken(token) {
      const hit = ephemeral.get(hashToken(String(token || '')));
      if (hit && hit.expires > Date.now()) return hit.agent;
      return persistent.byToken(token);
    },
    touch: id => persistent.touch(id)
  };

  async function executeApproved(type, p) {
    const call = ctx.internalRequest;
    switch (type) {
      case 'send':
        return call(
          'POST',
          `/api/messages/send?account=${q(p.account)}`,
          {
            requestId: randomUUID(),
            confirm: 'SEND',
            to: p.to,
            cc: p.cc || [],
            bcc: [],
            subject: p.subject,
            text: p.text,
            inReplyTo: p.inReplyTo,
            references: p.inReplyTo
          },
          'send-v1'
        );
      case 'event':
        return call('POST', '/api/calendar/events/save', p, 'calendar-v1');
      case 'contact':
        return call('POST', '/api/contacts/save', p, 'contacts-v1');
      case 'trash':
        return call(
          'POST',
          `/api/messages/${Number(p.uid)}/action?account=${q(p.account)}`,
          { folder: p.folder, action: 'trash' },
          'mail-v1'
        );
      default: {
        const custom = mcpToolRegistry(ctx).approval(type);
        if (!custom) throw new Error('Unbekannte Freigabe.');
        return custom.execute(p);
      }
    }
  }
  ctx.executeApproved = executeApproved;
  const approvals = createApprovals(approvalsFile, { execute: executeApproved, log: ctx.ai.log });
  ctx.approvals = approvals;
  const handle = createMcpHandler(ctx, { approvals, log: ctx.ai.log, version: ctx.version });
  const http = createMcpHttpServer({ handle, agents, port: file.get().port, logger: ctx.logger });

  async function sync() {
    const s = file.get();
    if (s.enabled && !http.running)
      await http.start(s.port).catch(err => ctx.logger(`MCP server not started: ${err.code || err.message}`));
    if (!s.enabled && http.running && !ephemeral.size) await http.stop();
  }

  /** A token for one run of the built-in assistant; valid for at most 20 minutes. */
  async function internalAgent({ name = 'Levuvo Mail Assistant', level = 'draft' } = {}) {
    if (!LEVELS.includes(level)) throw new TypeError(`unknown level ${level}`);
    if (!http.running) await http.start(file.get().enabled ? file.get().port : 0);
    const token = `lvm_${randomBytes(32).toString('hex')}`;
    const key = hashToken(token);
    ephemeral.set(key, {
      agent: { id: `internal-${key.slice(0, 12)}`, name, level, autoSend: false },
      expires: Date.now() + 20 * 60_000
    });
    return {
      token,
      url: `http://127.0.0.1:${http.port}/mcp`,
      release: async () => {
        ephemeral.delete(key);
        await sync();
      }
    };
  }

  function bridgeConfig(port) {
    const where = resolveSidecar({});
    const env = { LEVUVO_MCP_TOKEN: '<TOKEN>' };
    if (where.pythonPath) env.PYTHONPATH = where.pythonPath;
    return {
      mcpServers: {
        'levuvo-mail': {
          command: where.command,
          args: [...(where.bundled ? ['-I'] : []), '-m', 'levuvo_ai.mcp_bridge', '--port', String(port)],
          env
        }
      }
    };
  }
  const publicState = () => {
    const s = file.get();
    return {
      enabled: s.enabled === true,
      port: s.port,
      running: http.running,
      url: `http://127.0.0.1:${s.port}/mcp`,
      levels: LEVELS,
      agents: persistent.list(),
      pending: approvals.list().length,
      bridge: bridgeConfig(s.port)
    };
  };

  const { api, requireAction } = ctx;
  const guard = (route, fn, limit = 8 * 1024) =>
    api.post(route, { bodyLimit: limit }, async (request, reply) => {
      if (!requireAction(request, reply, ACTION)) return;
      try {
        return await fn(request.body || {});
      } catch (err) {
        return reply
          .code(err.statusCode || 500)
          .send({ error: err.statusCode ? err.message : 'Aktion fehlgeschlagen.' });
      }
    });
  api.get('/api/mcp', async () => publicState());
  guard('/api/mcp/settings', async b => {
    const s = file.get();
    const port = b.port === undefined ? s.port : Number(b.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw Object.assign(new Error('Ungültiger Port (1024 bis 65535).'), { statusCode: 400 });
    const restart = port !== s.port && http.running;
    await file.save({ ...s, enabled: b.enabled === undefined ? s.enabled : b.enabled === true, port });
    if (restart) await http.stop();
    await sync();
    void ctx.ai.log.add({ type: 'settings', kind: 'mcp', enabled: file.get().enabled });
    return publicState();
  });
  guard('/api/mcp/agents/create', async b => {
    const created = await persistent.create({ name: b.name, level: b.level, autoSend: b.autoSend === true });
    void ctx.ai.log.add({
      type: 'agent_access',
      agent: created.agent.name,
      kind: 'created',
      status: created.agent.level
    });
    return { ...created, state: publicState() };
  });
  guard('/api/mcp/agents/update', async b => {
    await persistent.update(String(b.id || ''), { level: b.level, autoSend: b.autoSend });
    return publicState();
  });
  guard('/api/mcp/agents/remove', async b => {
    await persistent.remove(String(b.id || ''));
    void ctx.ai.log.add({ type: 'agent_access', kind: 'removed' });
    return publicState();
  });
  api.get('/api/mcp/approvals', async () => ({
    pending: approvals.list().map(i => ({ ...i, payload: undefined })),
    recent: approvals.recent().map(i => ({ ...i, payload: undefined }))
  }));
  guard(
    '/api/mcp/approvals/decide',
    async b => {
      const edits = b.edits && typeof b.edits === 'object' ? b.edits : null;
      const item = await approvals.decide(String(b.id || ''), b.approve === true, edits);
      return { ...item, payload: undefined };
    },
    64 * 1024
  );
  ctx.aiForgetHooks.push(async () => {
    await persistent.clear();
    await approvals.clear();
    ephemeral.clear();
    await file.save({ ...file.get(), enabled: false });
    await http.stop();
  });

  return { start: sync, stop: () => http.stop(), internalAgent, http, agents: persistent, approvals };
}
