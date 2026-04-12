/**
 * Puppeteer-in-sandbox Micro-experiment
 * -------------------------------------
 * Goal: answer ONE question — can we install Puppeteer (which bundles
 * Chromium) inside a default `blaxel/base-image:latest` sandbox and
 * successfully launch it?
 *
 * This is the last unknown for the Run on Cloud architecture. If yes,
 * we lock in Plan #1 (runtime npm install). If no, we pivot to Plan #3
 * (custom Blaxel template with Chromium preinstalled).
 *
 * Steps (each step fails independently with a clear signal):
 *   1. Create sandbox with port 9222 exposed
 *   2. Probe OS + Node version + writable /tmp
 *   3. npm init + npm install puppeteer (stream stdout so we see progress)
 *   4. Try puppeteer.launch({headless:'new', args:['--no-sandbox']}) via a
 *      probe script uploaded through sandbox.fs.write
 *      → if this fails, run `ldd` on the Chromium binary to identify
 *        missing .so files — that tells us EXACTLY what's wrong
 *   5. Launch Chromium with --remote-debugging-port=9222 as a background
 *      process, verify localhost:9222/json/version responds inside sandbox
 *   6. Create public preview URL for 9222, verify HTTPS /json/version
 *      round-trip from dev machine
 *   7. Rewrite the WS URL host and verify a basic CDP command round-trip
 *   8. Cleanup
 *
 * NOTE: every sandbox.process.exec / sandbox.fs.write call is a Blaxel
 * SDK call that runs INSIDE the remote sandbox over HTTPS. Not Node's
 * local child_process.
 */

import { SandboxInstance } from "@blaxel/core";
import WebSocket from "ws";

const { BL_WORKSPACE, BL_API_KEY } = process.env;
if (!BL_WORKSPACE || !BL_API_KEY) {
  console.error("Missing BL_WORKSPACE or BL_API_KEY env vars");
  process.exit(2);
}

const SANDBOX_NAME = `axolotl-pup-exp-${Date.now()}`;
const REGION = process.env.BL_REGION || "us-pdx-1";

const log = (p, m) => console.log(`[${p}] ${m}`);
const ok = (p, m) => console.log(`[${p}] OK  ${m}`);
const fail = (p, m) => console.error(`[${p}] FAIL ${m}`);

let sandbox = null;

async function cleanup(reason = "cleanup") {
  if (!sandbox) return;
  try {
    log("cleanup", `Deleting sandbox (${reason})...`);
    await SandboxInstance.delete(SANDBOX_NAME);
    ok("cleanup", "Sandbox deleted");
  } catch (e) {
    fail("cleanup", `delete failed: ${e?.message || e}`);
  }
}
process.on("SIGINT", async () => { await cleanup("SIGINT"); process.exit(130); });

// A helper that runs a command, waits for it, and returns { stdout, stderr, code }
async function run(name, command, { timeout = 60_000, workingDir } = {}) {
  await sandbox.process.exec({
    name,
    command,
    workingDir,
    waitForCompletion: true,
    timeout,
    onLog: (line) => process.stdout.write(`    [${name}] ${line}`),
  });
  const stdout = (await sandbox.process.logs(name, "stdout")) || "";
  const stderr = (await sandbox.process.logs(name, "stderr")) || "";
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function main() {
  // ─── Step 1: create sandbox ───
  log("1", `Creating sandbox "${SANDBOX_NAME}" in ${REGION} with port 9222...`);
  sandbox = await SandboxInstance.create(
    {
      name: SANDBOX_NAME,
      region: REGION,
      memory: 4096, // puppeteer + chromium wants more RAM
      ports: [{ name: "cdp", target: 9222, protocol: "HTTP" }],
    },
    { safe: true },
  );
  ok("1", "Sandbox ready");

  // ─── Step 2: probe environment ───
  log("2", "Probing OS / Node / /tmp writability...");
  const os = await run("os-probe", "cat /etc/os-release 2>/dev/null || uname -a");
  console.log("    → OS:", os.stdout.split("\n").slice(0, 3).join(" | "));
  const node = await run("node-probe", "node --version && which node && npm --version");
  console.log("    → Node:", node.stdout.replace(/\n/g, " "));
  const tmp = await run("tmp-probe", "mkdir -p /tmp/pup-exp && touch /tmp/pup-exp/x && rm /tmp/pup-exp/x && echo ok");
  if (!tmp.stdout.includes("ok")) throw new Error("Step 2 FAIL: /tmp not writable");
  ok("2", "environment probe passed");

  // ─── Step 3: npm install puppeteer ───
  log("3", "Running `npm init -y && npm install puppeteer --no-audit --no-fund` (may take 60-120s)...");
  await run(
    "npm-init",
    "cd /tmp/pup-exp && npm init -y",
    { timeout: 20_000 },
  );
  try {
    await run(
      "npm-install-puppeteer",
      "cd /tmp/pup-exp && npm install puppeteer --no-audit --no-fund 2>&1",
      { timeout: 300_000 },
    );
  } catch (e) {
    fail("3", `npm install failed: ${e?.message || e}`);
    // Try to get the stderr from the failed process
    try {
      const logs = await sandbox.process.logs("npm-install-puppeteer", "all");
      console.error("    ↓ npm install logs:");
      console.error(logs);
    } catch {}
    throw e;
  }
  const verify = await run(
    "verify-install",
    "ls /tmp/pup-exp/node_modules/puppeteer/package.json && cat /tmp/pup-exp/node_modules/puppeteer/package.json | grep -i '\"version\"'",
  );
  ok("3", `puppeteer installed: ${verify.stdout.replace(/\n/g, " ").slice(0, 120)}`);

  // ─── Step 4: probe launch via uploaded script ───
  log("4", "Uploading launch probe and attempting puppeteer.launch()...");
  const probeSource = `
const path = '/tmp/pup-exp/node_modules/puppeteer';
(async () => {
  let puppeteer;
  try { puppeteer = require(path); }
  catch (e) { console.error('REQUIRE_FAIL:', e.message); process.exit(10); }
  try {
    const exec = puppeteer.executablePath ? puppeteer.executablePath() : null;
    console.log('EXECUTABLE_PATH:', exec || '(none)');
  } catch (e) { console.log('EXECUTABLE_PATH_ERR:', e.message); }
  try {
    const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
    const v = await b.version();
    console.log('LAUNCH_OK:', v);
    await b.close();
    process.exit(0);
  } catch (e) {
    console.error('LAUNCH_FAIL:', e.message);
    process.exit(20);
  }
})();
`;
  await sandbox.fs.write("/tmp/pup-exp/probe.js", probeSource);
  let launchSucceeded = false;
  try {
    const probe = await run("launch-probe", "cd /tmp/pup-exp && node probe.js 2>&1", { timeout: 60_000 });
    if (probe.stdout.includes("LAUNCH_OK")) {
      ok("4", `puppeteer.launch() succeeded. ${probe.stdout.split("\n").find(l => l.startsWith("LAUNCH_OK"))}`);
      launchSucceeded = true;
    } else {
      fail("4", "launch probe returned without LAUNCH_OK marker");
      console.error("    probe stdout:", probe.stdout);
    }
  } catch (e) {
    fail("4", `launch probe threw: ${e?.message || e}`);
    try {
      const logs = await sandbox.process.logs("launch-probe", "all");
      console.error("    probe logs:", logs);
    } catch {}
  }

  if (!launchSucceeded) {
    // Diagnose: ldd the Chromium binary to see what .so files are missing
    log("4.diag", "Running ldd on Chromium binary to identify missing libraries...");
    try {
      const findBin = await run(
        "find-chrome",
        "find /tmp/pup-exp/node_modules/puppeteer -type f \\( -name 'chrome' -o -name 'chromium' -o -name 'headless_shell' \\) 2>/dev/null | head -5",
      );
      console.log("    → Chromium binaries found:", findBin.stdout || "(none)");
      if (findBin.stdout) {
        const firstBin = findBin.stdout.split("\n")[0];
        const ldd = await run("ldd-chrome", `ldd "${firstBin}" 2>&1 | grep -i 'not found' || echo "ALL_LIBS_OK"`);
        console.log("    → ldd missing libs:");
        console.log(ldd.stdout);
      }
    } catch (e) {
      console.error("    diagnosis failed:", e?.message);
    }
    throw new Error("Step 4 FAIL: puppeteer.launch() did not succeed");
  }

  // ─── Step 5: launch Chromium with remote-debugging for CDP testing ───
  log("5", "Starting Chromium with --remote-debugging-port=9222 in background...");
  // Get the Chromium path first
  const pathProbe = await run(
    "chrome-path",
    `node -e "console.log(require('/tmp/pup-exp/node_modules/puppeteer').executablePath())"`,
  );
  const chromePath = pathProbe.stdout.trim().split("\n").pop();
  if (!chromePath || !chromePath.startsWith("/")) {
    throw new Error(`Step 5 FAIL: could not resolve Chromium path, got: ${chromePath}`);
  }
  log("5", `  Chromium path: ${chromePath}`);
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
  ok("5", "Chromium running on 9222");

  // ─── Step 6: verify CDP via preview URL ───
  log("6", "Creating public preview URL for port 9222...");
  const cdpPreview = await sandbox.previews.create({
    metadata: { name: "cdp-preview" },
    spec: { port: 9222, public: true },
  });
  const cdpUrl = cdpPreview.spec?.url;
  if (!cdpUrl) throw new Error("Step 6 FAIL: preview URL missing");
  ok("6", `CDP preview URL: ${cdpUrl}`);
  await new Promise(r => setTimeout(r, 2000));
  const versionRes = await fetch(`${cdpUrl}/json/version`, { redirect: "follow" });
  if (!versionRes.ok) throw new Error(`Step 6 FAIL: /json/version → ${versionRes.status}`);
  const version = await versionRes.json();
  ok("6", `CDP /json/version works. Real browser: ${version.Browser}`);
  const originalWsUrl = version.webSocketDebuggerUrl;
  if (!originalWsUrl) throw new Error("Step 6 FAIL: no webSocketDebuggerUrl");
  log("6", `  Original WS URL: ${originalWsUrl}`);

  // ─── Step 7: verify WS round-trip with real Chromium ───
  log("7", "Rewriting WS host to preview origin and opening WebSocket...");
  const previewOrigin = new URL(cdpUrl);
  const wsScheme = previewOrigin.protocol === "https:" ? "wss:" : "ws:";
  const rewrittenWs = `${wsScheme}//${previewOrigin.host}${new URL(originalWsUrl).pathname}`;
  log("7", `  Rewritten WS URL: ${rewrittenWs}`);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(rewrittenWs, { handshakeTimeout: 15_000 });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WS timeout after 20s")); }, 20_000);
    ws.on("open", () => {
      log("7", "  WS connected to REAL Chromium. Sending Target.getTargets...");
      ws.send(JSON.stringify({ id: 1, method: "Target.getTargets" }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        const targets = msg.result?.targetInfos;
        if (!targets) reject(new Error(`CDP response missing result: ${data}`));
        else { ok("7", `CDP over WS works with real Chromium (${targets.length} targets)`); resolve(); }
      }
    });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });

  console.log("");
  console.log("==============================================================");
  console.log("  PUPPETEER-IN-SANDBOX EXPERIMENT: ALL GREEN");
  console.log("==============================================================");
  console.log("  ✓ Default blaxel/base-image:latest has compatible OS + Node");
  console.log("  ✓ npm install puppeteer works (Chromium downloaded)");
  console.log("  ✓ puppeteer.launch() succeeds in sandbox");
  console.log("  ✓ Chromium with --remote-debugging-port=9222 works");
  console.log("  ✓ Real CDP /json/version HTTP over HTTPS preview URL");
  console.log("  ✓ Real CDP WebSocket over WSS preview URL");
  console.log("");
  console.log("-> Plan #1 (runtime npm install puppeteer) is VIABLE.");
  console.log("-> No need for custom Blaxel template.");
  console.log("==============================================================");
}

main()
  .then(async () => { await cleanup("success"); process.exit(0); })
  .catch(async (err) => {
    console.error("");
    console.error("==============================================================");
    console.error("  EXPERIMENT FAILED");
    console.error("==============================================================");
    console.error(err instanceof Error ? err.stack : err);
    console.error("");
    console.error("Decision matrix based on which step failed:");
    console.error("  Step 1-2  → Blaxel setup issue. Re-run smoke test first.");
    console.error("  Step 3    → npm install failed. Check sandbox network or npm registry.");
    console.error("              → Pivot to Plan #3 (custom template).");
    console.error("  Step 4    → puppeteer.launch failed. ldd output above tells you");
    console.error("              which .so files are missing.");
    console.error("              → Pivot to Plan #3 (custom template with those libs).");
    console.error("  Step 5-7  → CDP connection failed. Unexpected — smoke test v3");
    console.error("              already proved preview URL proxy works.");
    await cleanup("failure");
    process.exit(1);
  });
