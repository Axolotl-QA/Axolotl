/**
 * Chromium-via-apk Micro-experiment (v2)
 * --------------------------------------
 * Previous experiment revealed: blaxel/base-image:latest is ALPINE LINUX 3.23.
 * Alpine uses musl libc, so Puppeteer's bundled Chromium (glibc-only) won't run.
 *
 * BUT Alpine has a native musl-built Chromium package via `apk add chromium`.
 * This experiment tests:
 *   1. Create sandbox with default Alpine image
 *   2. Run `apk add --no-cache chromium` (Alpine package manager)
 *   3. Verify `chromium` binary is available
 *   4. Launch chromium --headless --remote-debugging-port=9222 in background
 *   5. Verify /json/version responds from localhost inside sandbox
 *   6. Create public preview URL for 9222
 *   7. Fetch /json/version from dev machine via preview URL
 *   8. Open WebSocket + send Target.getTargets → verify CDP works with REAL Chromium
 *   9. Cleanup
 *
 * If all green: Plan #5 locked in (apk add chromium, zero custom image).
 * If apk add fails: must pivot to custom Blaxel template.
 * If launch fails: Alpine chromium has different CLI flags or missing libs.
 */

import { SandboxInstance } from "@blaxel/core";
import WebSocket from "ws";

const { BL_WORKSPACE, BL_API_KEY } = process.env;
if (!BL_WORKSPACE || !BL_API_KEY) {
  console.error("Missing BL_WORKSPACE or BL_API_KEY env vars");
  process.exit(2);
}

const SANDBOX_NAME = `axolotl-apk-exp-${Date.now()}`;
const REGION = process.env.BL_REGION || "us-pdx-1";

const log = (p, m) => console.log(`[${p}] ${m}`);
const ok = (p, m) => console.log(`[${p}] OK  ${m}`);

let sandbox = null;

async function cleanup(reason = "cleanup") {
  if (!sandbox) return;
  try {
    log("cleanup", `Deleting sandbox (${reason})...`);
    await SandboxInstance.delete(SANDBOX_NAME);
    ok("cleanup", "Sandbox deleted");
  } catch (e) {
    console.error("cleanup delete failed:", e?.message || e);
  }
}
process.on("SIGINT", async () => { await cleanup("SIGINT"); process.exit(130); });

async function runSh(name, shellCmd, { timeout = 120_000 } = {}) {
  // Wrap in sh -c so shell features (&&, ||, pipes) actually work
  try {
    await sandbox.process.exec({
      name,
      command: `sh -c ${JSON.stringify(shellCmd)}`,
      waitForCompletion: true,
      timeout,
      onLog: (line) => process.stdout.write(`    [${name}] ${line}`),
    });
  } catch (e) {
    // Keep going so we can inspect logs below
    console.error(`    [${name}] ERR: ${e?.message || e}`);
  }
  const stdout = (await sandbox.process.logs(name, "stdout").catch(() => "")) || "";
  const stderr = (await sandbox.process.logs(name, "stderr").catch(() => "")) || "";
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function main() {
  log("1", `Creating sandbox "${SANDBOX_NAME}" in ${REGION}...`);
  sandbox = await SandboxInstance.create(
    {
      name: SANDBOX_NAME,
      region: REGION,
      memory: 2048,
      ports: [{ name: "cdp", target: 9222, protocol: "HTTP" }],
    },
    { safe: true },
  );
  ok("1", "Sandbox ready");

  log("2", "Running `apk add --no-cache chromium` (may take 30-90s)...");
  const apk = await runSh("apk-install", "apk add --no-cache chromium 2>&1", { timeout: 300_000 });
  // Verify chromium is available now
  const which = await runSh("which-chromium", "command -v chromium || command -v chromium-browser || echo NOTFOUND");
  console.log(`    → chromium path: ${which.stdout}`);
  if (!which.stdout || which.stdout.includes("NOTFOUND")) {
    console.error("apk stdout tail:", apk.stdout.split("\n").slice(-10).join("\n"));
    console.error("apk stderr tail:", apk.stderr.split("\n").slice(-10).join("\n"));
    throw new Error("Step 2 FAIL: `apk add chromium` did not produce a chromium binary");
  }
  const chromiumPath = which.stdout.split("\n").pop().trim();
  ok("2", `Chromium installed at ${chromiumPath}`);

  log("3", "Checking Chromium version...");
  const version = await runSh("chrome-version", `${chromiumPath} --version 2>&1 || echo LAUNCH_ERROR`);
  console.log(`    → ${version.stdout}`);
  if (version.stdout.includes("LAUNCH_ERROR") || !version.stdout.toLowerCase().includes("chromium")) {
    throw new Error(`Step 3 FAIL: Chromium can't even print its version: ${version.stdout}`);
  }
  ok("3", `Chromium binary runs (${version.stdout.split("\n")[0]})`);

  log("4", "Starting Chromium headless with --remote-debugging-port=9222...");
  await sandbox.process.exec({
    name: "chromium-cdp",
    command:
      `${chromiumPath} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage ` +
      `--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 ` +
      `--user-data-dir=/tmp/chrome-profile about:blank`,
    waitForCompletion: false,
    waitForPorts: [9222],
    keepAlive: true,
  });
  ok("4", "Chromium running on 9222");

  log("5", "Probing localhost:9222/json/version from inside sandbox...");
  const localProbe = await runSh(
    "local-cdp-probe",
    "wget -qO- http://localhost:9222/json/version 2>&1 || curl -s http://localhost:9222/json/version 2>&1 || echo PROBE_FAILED",
  );
  console.log("    → local probe:", localProbe.stdout.slice(0, 200));
  if (localProbe.stdout.includes("PROBE_FAILED")) {
    console.error("CDP endpoint not reachable from inside sandbox");
    throw new Error("Step 5 FAIL");
  }
  ok("5", "CDP endpoint reachable from localhost inside sandbox");

  log("6", "Creating public preview URL for port 9222...");
  const cdpPreview = await sandbox.previews.create({
    metadata: { name: "cdp-preview" },
    spec: { port: 9222, public: true },
  });
  const cdpUrl = cdpPreview.spec?.url;
  if (!cdpUrl) throw new Error("Step 6 FAIL: preview URL missing");
  ok("6", `CDP preview URL: ${cdpUrl}`);

  log("7", `Fetching ${cdpUrl}/json/version from dev machine...`);
  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch(`${cdpUrl}/json/version`, { redirect: "follow" });
  if (!res.ok) throw new Error(`Step 7 FAIL: ${res.status} ${res.statusText}`);
  const v = await res.json();
  ok("7", `REAL Chromium CDP over HTTPS preview URL works! Browser: ${v.Browser}`);
  const originalWs = v.webSocketDebuggerUrl;
  log("7", `  reported WS URL: ${originalWs}`);

  log("8", "Rewriting WS host to preview origin and verifying CDP command...");
  const origin = new URL(cdpUrl);
  const wsScheme = origin.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsScheme}//${origin.host}${new URL(originalWs).pathname}`;
  log("8", `  rewritten WS URL: ${wsUrl}`);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 15_000 });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WS timeout")); }, 20_000);
    ws.on("open", () => {
      log("8", "  WS connected to real Chromium. Sending Target.getTargets...");
      ws.send(JSON.stringify({ id: 1, method: "Target.getTargets" }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        const targets = msg.result?.targetInfos;
        if (!targets) reject(new Error(`no result: ${data}`));
        else { ok("8", `REAL CDP round-trip works (${targets.length} targets)`); resolve(); }
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });

  console.log("");
  console.log("==============================================================");
  console.log("  CHROMIUM-VIA-APK EXPERIMENT: ALL GREEN");
  console.log("==============================================================");
  console.log("  ✓ Default blaxel/base-image:latest is Alpine 3.23");
  console.log("  ✓ `apk add --no-cache chromium` works");
  console.log("  ✓ Alpine's musl-built Chromium runs");
  console.log("  ✓ --remote-debugging-port=9222 exposes CDP");
  console.log("  ✓ Public preview URL proxies CDP HTTP");
  console.log("  ✓ Public preview URL proxies CDP WebSocket upgrade");
  console.log("  ✓ Full Target.getTargets round-trip with REAL Chromium");
  console.log("");
  console.log("→ Plan #5 (apk add chromium in default image) is LOCKED IN.");
  console.log("→ No custom Blaxel template needed.");
  console.log("→ No puppeteer install in sandbox. Host-side Puppeteer connects");
  console.log("  to remote Chromium via preview URL.");
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
    await cleanup("failure");
    process.exit(1);
  });
