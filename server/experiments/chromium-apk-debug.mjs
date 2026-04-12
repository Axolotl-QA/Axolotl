/**
 * Chromium-via-apk experiment with FILE-based debug log.
 * Writes every step directly to /tmp/apk-debug.log via fs.appendFileSync
 * to rule out any stdout buffering / Bash tool truncation issues.
 */
import { SandboxInstance } from "@blaxel/core";
import WebSocket from "ws";
import fs from "node:fs";

const DEBUG_LOG = "/tmp/apk-debug.log";
fs.writeFileSync(DEBUG_LOG, `=== RUN STARTED ${new Date().toISOString()} ===\n`);
const dbg = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(DEBUG_LOG, line); } catch {}
  process.stdout.write(line);
};

process.on("uncaughtException", (e) => {
  dbg(`UNCAUGHT EXCEPTION: ${e?.stack || e}`);
  process.exit(99);
});
process.on("unhandledRejection", (e) => {
  dbg(`UNHANDLED REJECTION: ${e?.stack || e}`);
  process.exit(98);
});
process.on("exit", (code) => {
  try { fs.appendFileSync(DEBUG_LOG, `=== PROCESS EXIT ${code} ===\n`); } catch {}
});

const { BL_WORKSPACE, BL_API_KEY } = process.env;
if (!BL_WORKSPACE || !BL_API_KEY) {
  dbg("MISSING ENV VARS");
  process.exit(2);
}

const SANDBOX_NAME = `axolotl-apk-dbg-${Date.now()}`;
const REGION = process.env.BL_REGION || "us-pdx-1";
let sandbox = null;

async function main() {
  dbg("step 1: creating sandbox");
  sandbox = await SandboxInstance.create(
    {
      name: SANDBOX_NAME,
      region: REGION,
      memory: 2048,
      ports: [{ name: "cdp", target: 9222, protocol: "HTTP" }],
    },
    { safe: true },
  );
  dbg(`step 1 done: ${SANDBOX_NAME}`);

  dbg("step 2: starting apk add chromium (waitForCompletion=true, timeout=300s)");
  let apkError = null;
  try {
    await sandbox.process.exec({
      name: "apk-install",
      command: "sh -c 'apk add --no-cache chromium 2>&1'",
      waitForCompletion: true,
      timeout: 300_000,
    });
  } catch (e) {
    apkError = e;
    dbg(`step 2 exec threw: ${e?.message || e}`);
  }
  dbg(`step 2 exec returned (error=${apkError ? 'YES' : 'no'})`);

  dbg("step 2.1: fetching apk-install stdout");
  let apkLogs = "";
  try {
    apkLogs = await sandbox.process.logs("apk-install", "stdout");
  } catch (e) {
    dbg(`step 2.1 logs fetch threw: ${e?.message || e}`);
  }
  dbg(`step 2.1 stdout length=${(apkLogs || "").length}, last 500 chars:`);
  dbg(`---LOGS-START---`);
  dbg((apkLogs || "").slice(-500));
  dbg(`---LOGS-END---`);

  dbg("step 3: checking if chromium binary exists");
  let whichOut = "";
  try {
    await sandbox.process.exec({
      name: "which-chrome",
      command: "sh -c 'command -v chromium || command -v chromium-browser || echo NOTFOUND'",
      waitForCompletion: true,
      timeout: 10_000,
    });
    whichOut = await sandbox.process.logs("which-chrome", "stdout");
  } catch (e) {
    dbg(`step 3 threw: ${e?.message || e}`);
  }
  dbg(`step 3 result: ${JSON.stringify(whichOut)}`);
  const chromePath = (whichOut || "").trim().split("\n").pop();
  if (!chromePath || chromePath.includes("NOTFOUND")) {
    dbg(`chromium not installed. Trying another apk status check...`);
    try {
      await sandbox.process.exec({
        name: "apk-info",
        command: "sh -c 'apk info -e chromium 2>&1 && echo \"---\" && apk search chromium 2>&1'",
        waitForCompletion: true,
        timeout: 30_000,
      });
      const info = await sandbox.process.logs("apk-info", "stdout");
      dbg(`apk-info: ${info}`);
    } catch (e) {
      dbg(`apk-info threw: ${e?.message}`);
    }
    throw new Error(`No chromium binary found. chromePath=${JSON.stringify(chromePath)}`);
  }
  dbg(`step 3 OK: chromium at ${chromePath}`);

  dbg("step 4: checking chromium --version");
  await sandbox.process.exec({
    name: "chrome-version",
    command: `sh -c '${chromePath} --version 2>&1'`,
    waitForCompletion: true,
    timeout: 30_000,
  });
  const ver = (await sandbox.process.logs("chrome-version", "stdout")).trim();
  dbg(`step 4: ${ver}`);

  dbg("step 5: launching chromium --remote-debugging-port=9222");
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
  dbg("step 5 done: chromium running on 9222");

  dbg("step 6: creating CDP preview URL");
  const cdpPreview = await sandbox.previews.create({
    metadata: { name: "cdp-preview" },
    spec: { port: 9222, public: true },
  });
  const cdpUrl = cdpPreview.spec?.url;
  dbg(`step 6: ${cdpUrl}`);

  dbg("step 7: fetching /json/version from dev machine");
  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch(`${cdpUrl}/json/version`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const v = await res.json();
  dbg(`step 7 OK: Browser=${v.Browser}, WS=${v.webSocketDebuggerUrl}`);

  dbg("step 8: WS round-trip");
  const origin = new URL(cdpUrl);
  const wsUrl = `${origin.protocol === "https:" ? "wss:" : "ws:"}//${origin.host}${new URL(v.webSocketDebuggerUrl).pathname}`;
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 15_000 });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WS timeout")); }, 20_000);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Target.getTargets" })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (!msg.result?.targetInfos) reject(new Error(`no result: ${data}`));
        else resolve(msg.result.targetInfos.length);
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  }).then(n => dbg(`step 8 OK: ${n} targets`));

  dbg("ALL GREEN");
}

main()
  .then(async () => {
    dbg("main resolved, cleaning up");
    try {
      await SandboxInstance.delete(SANDBOX_NAME);
      dbg("sandbox deleted");
    } catch (e) {
      dbg(`delete failed: ${e?.message}`);
    }
    process.exit(0);
  })
  .catch(async (err) => {
    dbg(`main rejected: ${err?.stack || err}`);
    try { await SandboxInstance.delete(SANDBOX_NAME); } catch {}
    process.exit(1);
  });
