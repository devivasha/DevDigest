/**
 * smoke.mjs — end-to-end smoke test for the DevDigest MCP server.
 *
 * Spawns the server exactly the way Claude Code does (`npx tsx src/index.ts`),
 * performs a real JSON-RPC handshake over stdio, and asserts:
 *   1. exactly 5 devdigest_* tools are listed,
 *   2. devdigest_list_agents returns without error,
 *   3. an unknown repo yields a forward-leading isError,
 *   4. the blast-radius stub returns a non-error not_implemented,
 *   5. stdout carries ONLY valid JSON-RPC (no banner corruption).
 *
 * Prereq: the DevDigest API must be running (./scripts/dev.sh --no-client).
 *
 * Optional heavy check — a REAL review (LLM call). Off by default:
 *   SMOKE_RUN=1 SMOKE_REPO=acme/payments-api SMOKE_PR=482 SMOKE_AGENT="General Reviewer" pnpm smoke
 *
 * Exits 0 on all-pass, 1 on any failure.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const child = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: pkgRoot,
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
let rawStdout = "";
let stderr = "";
const pending = new Map();
const failures = [];

child.stderr.on("data", (d) => (stderr += d.toString()));
child.stdout.on("data", (d) => {
  rawStdout += d.toString();
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // handled by the stdout-cleanliness check below
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const rpc = (id, method, params) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for id=${id} (${method})`)), 140_000);
    pending.set(id, (m) => {
      clearTimeout(t);
      res(m);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
const call = (id, name, args) => rpc(id, "tools/call", { name, arguments: args });
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

let id = 0;
const nextId = () => ++id;

(async () => {
  await rpc(nextId(), "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  console.log("MCP smoke test\n");

  // 1. tools/list
  const list = await rpc(nextId(), "tools/list", {});
  const tools = list.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  const expected = [
    "devdigest_get_blast_radius",
    "devdigest_get_conventions",
    "devdigest_get_findings",
    "devdigest_list_agents",
    "devdigest_run_agent_on_pr",
  ];
  check(
    "exactly 5 devdigest_* tools listed",
    names.length === 5 && expected.every((n) => names.includes(n)),
    names.join(", "),
  );

  // 2. list_agents
  const agents = await call(nextId(), "devdigest_list_agents", {});
  const agentsOk = agents.result?.isError !== true;
  check("devdigest_list_agents returns (API reachable)", agentsOk,
    agentsOk ? "" : agents.result?.content?.[0]?.text);

  // 3. unknown repo → forward-leading isError
  const unknown = await call(nextId(), "devdigest_get_conventions", { repo: "no-such-repo-xyz" });
  check(
    "unknown repo → isError with guidance",
    unknown.result?.isError === true && /not found/i.test(unknown.result?.content?.[0]?.text ?? ""),
    unknown.result?.content?.[0]?.text?.slice(0, 80),
  );

  // 4. stub
  const blast = await call(nextId(), "devdigest_get_blast_radius", {});
  let blastPayload = {};
  try {
    blastPayload = JSON.parse(blast.result?.content?.[0]?.text ?? "{}");
  } catch {}
  check(
    "blast_radius stub → non-error not_implemented",
    blast.result?.isError !== true && blastPayload.status === "not_implemented",
  );

  // 5. stdout cleanliness
  const badLines = rawStdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      try {
        JSON.parse(l);
        return false;
      } catch {
        return true;
      }
    });
  check("stdout is clean JSON-RPC (no banner)", badLines.length === 0, badLines.join(" | "));

  // Optional heavy check: a real review run.
  if (process.env.SMOKE_RUN === "1") {
    const repo = process.env.SMOKE_REPO ?? "acme/payments-api";
    const pr = Number(process.env.SMOKE_PR ?? "482");
    const agent = process.env.SMOKE_AGENT ?? "General Reviewer";
    console.log(`\n  … running real review: ${agent} on ${repo}#${pr} (LLM call)`);
    const run = await call(nextId(), "devdigest_run_agent_on_pr", { repo, pr, agent });
    let payload = {};
    try {
      payload = JSON.parse(run.result?.content?.[0]?.text ?? "{}");
    } catch {}
    check(
      "run_agent_on_pr → verdict or running",
      run.result?.isError !== true && (payload.verdict !== undefined || payload.status === "running"),
      run.result?.content?.[0]?.text?.slice(0, 120),
    );
  }

  console.log(
    `\n${failures.length === 0 ? "PASS — all checks green" : `FAIL — ${failures.length} check(s) failed`}`,
  );
  if (failures.length) console.error("\nserver stderr:\n" + stderr.slice(0, 500));
  child.kill();
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("smoke error:", e.message);
  console.error("server stderr:\n" + stderr.slice(0, 500));
  child.kill();
  process.exit(1);
});
