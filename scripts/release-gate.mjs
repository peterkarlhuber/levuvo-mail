#!/usr/bin/env node
// Release gate: a release may only be built from a commit whose CI and CodeQL runs on the
// default branch finished successfully for exactly this SHA (push event). Waits while the runs
// are queued or in progress; fails on any other result or when no run appears in time.
//   GH_TOKEN=… node scripts/release-gate.mjs --repo owner/name --sha <commit> [--branch master]
// The CI run covers everything `release:check` does not: accessibility (Chromium), large
// mailbox benchmark, Python sidecar tests, unsigned desktop builds and the aggregate `CI passed`.
import { pathToFileURL } from 'node:url';

export const REQUIRED_WORKFLOWS = ['CI', 'CodeQL'];

/**
 * Decides from the workflow runs of one commit: 'ok', 'wait' or 'fail' (+ reason per workflow).
 * Only push runs on the given branches count; per workflow the newest attempt is decisive.
 */
export function evaluateRuns(runs, { sha, branches = ['master', 'main'], required = REQUIRED_WORKFLOWS } = {}) {
  const details = [];
  let state = 'ok';
  for (const name of required) {
    const candidates = (runs || [])
      .filter(r => r.name === name && r.head_sha === sha && r.event === 'push' && branches.includes(r.head_branch))
      .sort(
        (a, b) =>
          Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0) || (b.run_attempt || 0) - (a.run_attempt || 0)
      );
    const run = candidates[0];
    if (!run) {
      details.push(`${name}: no run for ${sha.slice(0, 12)} on ${branches.join('/')} yet`);
      if (state === 'ok') state = 'wait';
      continue;
    }
    if (run.status !== 'completed') {
      details.push(`${name}: ${run.status} (${run.html_url || run.id})`);
      if (state === 'ok') state = 'wait';
      continue;
    }
    if (run.conclusion !== 'success') {
      details.push(`${name}: ${run.conclusion} (${run.html_url || run.id})`);
      state = 'fail';
      continue;
    }
    details.push(`${name}: success (${run.html_url || run.id})`);
  }
  return { state, details };
}

async function fetchRuns({ api, repo, sha, token }) {
  const url = `${api}/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&event=push&per_page=100`;
  const res = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28'
    }
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).workflow_runs || [];
}

export async function waitForGate({
  repo,
  sha,
  branch = 'master',
  token,
  api = 'https://api.github.com',
  timeoutMs = 90 * 60_000,
  missingMs = 15 * 60_000,
  intervalMs = 30_000,
  getRuns = fetchRuns,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = () => Date.now(),
  log = console.log
}) {
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error('--sha must be a full commit SHA');
  const started = now();
  for (;;) {
    const runs = await getRuns({ api, repo, sha, token });
    const result = evaluateRuns(runs, { sha, branches: [branch] });
    for (const line of result.details) log(`  ${line}`);
    if (result.state !== 'wait') return result;
    const waited = now() - started;
    const missing = result.details.some(d => d.includes('no run for'));
    if (waited >= timeoutMs || (missing && waited >= missingMs))
      return { state: 'fail', details: [...result.details, `timed out after ${Math.round(waited / 60_000)} min`] };
    log(`… waiting ${Math.round(intervalMs / 1000)} s`);
    await sleep(intervalMs);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = name => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = arg('repo') || process.env.GITHUB_REPOSITORY;
  const sha = arg('sha') || process.env.GITHUB_SHA;
  if (!token || !repo) {
    console.error('::error::GH_TOKEN and --repo are required');
    process.exit(1);
  }
  console.log(`Release gate for ${repo}@${sha}: ${REQUIRED_WORKFLOWS.join(', ')} must have passed`);
  const result = await waitForGate({ repo, sha, branch: arg('branch') || 'master', token }).catch(err => ({
    state: 'fail',
    details: [err.message]
  }));
  if (result.state !== 'ok') {
    console.error(`::error::Release gate failed: ${result.details.join('; ')}`);
    process.exit(1);
  }
  console.log('✓ CI and CodeQL passed for this commit.');
}
