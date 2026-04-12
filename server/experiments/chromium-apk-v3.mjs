/**
 * Chromium-via-apk experiment v3 — works around SDK bug.
 *
 * Discovery: `sandbox.process.exec({ waitForCompletion: true })` silently
 * hangs on long-running commands (apk install). The promise never resolves
 * nor rejects; Node's event loop goes idle and the process exits cleanly
 * with code 0 mid-await.
 *
 * Workaround: `waitForCompletion: false` (starts immediately) + explicit
 * `sandbox.process.wait(name, { maxWait })` to block until done.
 */
import { SandboxInstance } from "@blaxel/core";
import WebSocket from "ws";
import fs from "node:fs";

const LOG = "/tmp/apk-v3.log";
fs.writeFileSync(LOG, `START ${new Date().toISOString()}\n`);
const d = (m) => {
  const line = `[${new Date().toISOString()}] ${m}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
};
process.on("exit", (c) => { try { fs.appendFileSync(LOG, `EXIT ${c}\n`); } catch {} });
process.on("uncaughtException", (e) => d(`UNCAUGHT: ${e?.stack || e}`));
process.on("unhandledRejection", (e) => d(`UNHANDLED: ${e?.stack || e}`));

const { BL_WORKSPACE, BL_API_KEY } = process.env;
if (!BL_WORKSPACE || !BL_API_KEY) { d("missing env"); process.exit(2); }

const SANDBOX_NAME = `axolotl-apk-v3-${Date.now()}`;
const REGION = process.env.BL_REGION || "us-pdx-1";
let sandbox = null;

// Start a process then wait for it to finish (workaround for SDK bug)
async function startAndWait(name, command, { maxWaitMs = 300_000 } = {}) {
  d(`  start: ${name}`);
  await sandbox.process.exec({
    name,
    command,
    waitForCompletion: false,
  });
  d(`  waiting for ${name} (maxWait ${maxWaitMs}ms)`);
  await sandbox.process.wait(name, { maxWait: maxWaitMs });
  const stdout = (await sandbox.process.logs(name, "stdout").catch(() => "")) || "";
  const stderr = (await sandbox.process.logs(name, "stderr").catch(() => "")) || "";
  const proc = await sandbox.process.get(name).catch(() => null);
  d(`  done: ${name}, exitCode=${proc?.exitCode}, stdoutLen=${stdout.length}`);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: proc?.exitCode };
}

async function main() {
  d("step 1: create sandbox");
  sandbox = await SandboxInstance.create(
    {
      name: SANDBOX_NAME,
      region: REGION,
      memory: 2048,
      ports: [{ name: "cdp", target: 9222, protocol: "HTTP" }],
    },
    { safe: true },
  );
  d(`step 1 done: ${SANDBOX_NAME}`);

  d("step 2: apk add chromium (long running ~60s)");
  const apk = await startAndWait(
    "apk-install",
    "sh -c 'apk add --no-cache chromium 2>&1'",
    { maxWaitMs: 300_000 },
  );
  d(`step 2: apk exit=${apk.exitCode}, stdout tail:`);
  d(apk.stdout.split("\n").slice(-5).join("\n"));
  if (apk.exitCode !== 0 && apk.exitCode !== "0") {
    throw new Error(`apk add failed with exit ${apk.exitCode}`);
  }

  d("step 3: find chromium binary");
  const which = await startAndWait(
    "which-chrome",
    "sh -c 'command -v chromium || command -v chromium-browser || echo NOTFOUND'",
    { maxWaitMs: 10_000 },
  );
  d(`step 3 stdout: ${JSON.stringify(which.stdout)}`);
  const chromePath = which.stdout.split("\n").pop().trim();
  if (!chromePath || chromePath.includes("NOTFOUND")) {
    throw new Error(`chromium not found: ${which.stdout}`);
  }
  d(`step 3 OK: ${chromePath}`);

  d("step 4: chromium --version");
  const ver = await startAndWait(
    "chrome-version",
    `sh -c '${chromePath} --version 2>&1'`,
    { maxWaitMs: 15_000 },
  );
  d(`step 4: ${ver.stdout}`);

  d("step 5: launch chromium with --remote-debugging-port=9222 (background)");
  await sandbox.process.exec({
    name: "chromium-cdp",
    command:
      `${chromePath} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage ` +
      `--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 ` +
      `--user-data-dir=/tmp/chrome-profile about:blank`,
    waitForCompletion: false,
    waitForPorts: [9222],
    keepAlive: true,
  });
  d("step 5 done");

  d("step 6: create public preview URL for 9222");
  const preview = await sandbox.previews.create({
    metadata: { name: "cdp-preview" },
    spec: { port: 9222, public: true },
  });
  const cdpUrl = preview.spec?.url;
  d(`step 6: ${cdpUrl}`);

  d("step 7: GET /json/version from dev machine");
  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch(`${cdpUrl}/json/version`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const v = await res.json();
  d(`step 7 OK: Browser=${v.Browser}`);
  d(`  webSocketDebuggerUrl=${v.webSocketDebuggerUrl}`);

  d("step 8: WebSocket upgrade + CDP round-trip");
  const origin = new URL(cdpUrl);
  const wsUrl = `${origin.protocol === "https:" ? "wss:" : "ws:"}//${origin.host}${new URL(v.webSocketDebuggerUrl).pathname}`;
  d(`  rewritten WS URL: ${wsUrl}`);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 15_000 });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WS timeout")); }, 20_000);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Target.getTargets" })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (!msg.result?.targetInfos) reject(new Error(`no result`));
        else resolve(msg.result.targetInfos.length);
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  }).then(n => d(`step 8 OK: ${n} targets from REAL Chromium`));

  d("ALL GREEN");
}

main()
  .then(async () => {
    d("main resolved, cleaning up");
    try { await SandboxInstance.delete(SANDBOX_NAME); d("deleted"); } catch (e) { d(`delete err: ${e?.message}`); }
    process.exit(0);
  })
  .catch(async (err) => {
    d(`main rejected: ${err?.stack || err}`);
    try { await SandboxInstance.delete(SANDBOX_NAME); } catch {}
    process.exit(1);
  });
