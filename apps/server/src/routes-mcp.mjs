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
  frameUntrusted,
  hashToken,
  mcpToolRegistry
} from './mcp-server.mjs';
import { registerTaskTools } from './ai-task-tools.mjs';
import { resolveSidecar } from './ai-sidecar.mjs';
import { CLOUD_PROVIDERS } from './ai-service.mjs';
import { createSkills, skillInstruction } from './ai-skills.mjs';
import { createSealedJsonFile } from './sealed-json.mjs';

const ACTION = 'ai-v1';
const q = s => encodeURIComponent(String(s));

export async function setupMcp(ctx, { createJsonFile, dir }) {
  const file = await createJsonFile(path.join(dir, 'mcp.json'), { enabled: false, port: DEFAULT_MCP_PORT, agents: [] });
  // Approvals hold message text until decided: encrypted on disk (key in the keychain), or in
  // memory only when there is no keychain.
  const approvalsFile = await createSealedJsonFile(
    path.join(dir, 'mcp-approvals.json'),
    { items: [] },
    { vault: ctx.store, keyName: 'mcp-approvals-key' }
  );
  const persistent = createAgentRegistry(file);
  // Task tools: they report "not available" until the task list (ctx.tasks) exists.
  registerTaskTools(ctx, { registry: mcpToolRegistry(ctx), frame: frameUntrusted });
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
  async function internalAgent({
    name = 'Levuvo Mail Assistant',
    level = 'draft',
    hiddenAccounts = [],
    cloud = true
  } = {}) {
    if (!LEVELS.includes(level)) throw new TypeError(`unknown level ${level}`);
    if (!http.running) await http.start(file.get().enabled ? file.get().port : 0);
    const token = `lvm_${randomBytes(32).toString('hex')}`;
    const key = hashToken(token);
    ephemeral.set(key, {
      agent: {
        id: `internal-${key.slice(0, 12)}`,
        name,
        level,
        autoSend: false,
        hiddenAccounts: [...hiddenAccounts],
        cloud: cloud !== false
      },
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
  // Routines and delegated tasks of the built-in assistant.
  const skills = await createSkills({ createJsonFile, dir });
  api.get('/api/ai/skills', async () => ({ skills: skills.list() }));
  guard('/api/ai/skills/save', async b => ({ skill: await skills.save(b), skills: skills.list() }));
  guard('/api/ai/skills/remove', async b => {
    await skills.remove(String(b.id || ''));
    return { skills: skills.list() };
  });
  let running = 0;
  api.post('/api/ai/agent', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    const b = request.body || {};
    const clientText = (v, n) => String(v ?? '').slice(0, n);
    let lease = null;
    let counted = false;
    try {
      const skill = b.skill ? skills.get(String(b.skill)) : null;
      if (b.skill && !skill) throw Object.assign(new Error('Unbekannte Routine.'), { statusCode: 400 });
      // A free task (delegation) may prepare drafts and proposals, never more.
      const instruction = skill ? skillInstruction(skill, b.params || {}) : clientText(b.instruction, 4000).trim();
      if (!instruction) throw Object.assign(new Error('Bitte eine Aufgabe eingeben.'), { statusCode: 400 });
      ctx.ai.ensureAllowed('agents', null);
      if (running >= 2) throw Object.assign(new Error('Es laufen schon zwei Aufgaben.'), { statusCode: 429 });
      running += 1;
      counted = true;
      const s = ctx.ai.get();
      lease = await internalAgent({
        name: skill ? `Levuvo Mail Assistant: ${skill.name}` : 'Levuvo Mail Assistant',
        level: skill?.level === 'read' ? 'read' : 'draft',
        // A cloud model never sees accounts marked "No cloud AI".
        hiddenAccounts: CLOUD_PROVIDERS.includes(s.provider) ? s.noCloudAccounts || [] : [],
        cloud: CLOUD_PROVIDERS.includes(s.provider)
      });
      const before = approvals.list().length;
      const result = await ctx.ai.agent(
        {
          mcpUrl: lease.url,
          token: lease.token,
          instruction,
          allowedTools: skill?.tools || [],
          maxSteps: 16,
          now: clientText(b.now, 40) || new Date().toISOString(),
          timeZone: clientText(b.timeZone, 60),
          lang: b.lang === 'en' ? 'en' : 'de'
        },
        { source: skill ? `routine:${skill.id}` : 'delegated' }
      );
      return {
        report: result.report,
        steps: result.steps,
        newApprovals: Math.max(0, approvals.list().length - before),
        provider: s.provider,
        model: s.model,
        generated: true
      };
    } catch (err) {
      const code = err.code || (err.kind ? `ai_${err.kind}` : undefined);
      return reply
        .code(err.statusCode || 500)
        .send({ error: err.statusCode ? err.message : 'Aufgabe fehlgeschlagen.', ...(code ? { code } : {}) });
    } finally {
      if (counted) running -= 1;
      if (lease) await lease.release();
    }
  });

  ctx.aiForgetHooks.push(async () => {
    await skills.clear();
    await persistent.clear();
    await approvals.clear();
    ephemeral.clear();
    await file.save({ ...file.get(), enabled: false });
    await http.stop();
  });

  return { start: sync, stop: () => http.stop(), internalAgent, http, agents: persistent, approvals };
}
