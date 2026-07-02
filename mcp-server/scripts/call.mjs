#!/usr/bin/env node
/**
 * Tiny stdio MCP client for ad-hoc testing of this server WITHOUT a UI.
 * Spawns `tsx src/index.ts`, performs the initialize handshake, calls one
 * tool, prints the result, and exits. Logs from the server (stderr) pass
 * through so you can see what it's doing.
 *
 * Usage (run from the mcp-server/ dir):
 *   node scripts/call.mjs <tool_name> '<json-args>'
 *
 * Examples:
 *   node scripts/call.mjs devdigest_list_agents
 *   node scripts/call.mjs devdigest_get_conventions '{"repo":"owner/name"}'
 *   node scripts/call.mjs devdigest_run_agent_on_pr '{"repo":"owner/name","pr":42,"agent":"<id>"}'
 *
 * Env: DEVDIGEST_API_URL (default http://localhost:3001) — the API must be up
 * (./scripts/dev.sh). Set MAX_WAIT_MS to extend the wait for long reviews.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const tool = process.argv[2];
if (!tool) {
  console.error('usage: node scripts/call.mjs <tool_name> [json-args]');
  process.exit(2);
}
let args = {};
if (process.argv[3]) {
  try {
    args = JSON.parse(process.argv[3]);
  } catch {
    console.error('error: second argument must be valid JSON');
    process.exit(2);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '..', 'src', 'index.ts');
const maxWaitMs = Number(process.env.MAX_WAIT_MS ?? 150_000);

const child = spawn('npx', ['tsx', entry], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, DEVDIGEST_API_URL: process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001' },
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');

let buf = '';
let done = false;
const finish = (code) => {
  if (done) return;
  done = true;
  child.kill('SIGTERM');
  process.exit(code);
};

child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 2) {
      const text = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.result ?? msg.error);
      console.log('isError:', !!msg.result?.isError);
      console.log(text);
      finish(0);
    }
  }
});

// Handshake: initialize -> initialized notification -> tools/call.
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'call.mjs', version: '0' },
  },
});
setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/initialized' }), 300);
setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } }), 600);

setTimeout(() => {
  console.error(`\n[call.mjs] no result within ${maxWaitMs}ms — giving up`);
  finish(1);
}, maxWaitMs);
