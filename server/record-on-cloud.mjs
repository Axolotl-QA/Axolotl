// record-on-cloud.mjs  — "Test on Cloud" cinematic CLI
//
// What it does, visibly, in ~35 seconds:
//   1. Provisions a Blaxel perpetual sandbox
//   2. Installs Chromium + ffmpeg in Alpine musl environment
//   3. git clones your GitHub repo + npm installs
//   4. Boots your app on :3000 and headless Chromium on :9222
//   5. Opens two public HTTPS preview URLs (app + CDP via Host-rewrite proxy)
//   6. Opens the LIVE app preview URL in Safari so evaluators can poke it
//   7. Uploads a recorder that drives the form via CDP Runtime.evaluate
//   8. Captures frames via CDP Page.captureScreenshot at 10 FPS
//   9. ffmpeg libx264 stitches frames into mp4
//  10. Exposes the mp4 via a public HTTPS preview URL, streams it home
//  11. Opens the video in QuickTime
//  12. Writes a full timeline log to ~/Downloads/axolotl-cloud-run-<id>.log
//
// Run: BL_WORKSPACE=axolotl BL_API_KEY=... BL_REGION=us-pdx-1 node record-on-cloud.mjs

import { SandboxInstance } from "@blaxel/core";
import { provisionCloudRun } from "./blaxel/sandboxRunner.js";
import {
  runInSandbox,
  startBackground,
  createPublicPreview,
} from "./blaxel/sandboxClient.js";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ── ANSI color helpers (terminal "theatrics") ─────────────────────────────
const C = {
  reset: "\x1b[0m",
  dim:   "\x1b[2m",
  bold:  "\x1b[1m",
  red:   "\x1b[31m",
  green: "\x1b[32m",
  yellow:"\x1b[33m",
  blue:  "\x1b[34m",
  cyan:  "\x1b[36m",
  white: "\x1b[37m",
  bgBlue:"\x1b[44m",
};
const useColor = process.stdout.isTTY || process.env.FORCE_COLOR;
const c = (color, s) => (useColor ? `${C[color]}${s}${C.reset}` : s);

// ── Timeline recording (for final summary + ~/Downloads log) ──────────────
const T0 = Date.now();
const timeline = [];
function mark(label, extra) {
  const t = ((Date.now() - T0) / 1000).toFixed(1);
  timeline.push({ t, label, extra });
  return t;
}

// ── Banner for a new stage ────────────────────────────────────────────────
let stageNum = 0;
function stage(title) {
  stageNum++;
  const n = String(stageNum).padStart(2, " ");
  const t = ((Date.now() - T0) / 1000).toFixed(1).padStart(5, " ");
  console.log("");
  console.log(c("cyan",   `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`));
  console.log(c("cyan",   `┃ `) + c("bold", `[${n}] t+${t}s  ${title}`.padEnd(57, " ")) + c("cyan", ` ┃`));
  console.log(c("cyan",   `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`));
}
function info(msg)    { console.log(c("dim",   "    │ ") + msg); }
function done(msg)    { console.log(c("green", "    ✓ ") + msg); }
function warn(msg)    { console.log(c("yellow","    ! ") + msg); }

const logger = {
  info:  (a, b) => info(`${b ?? ""} ${typeof a === "object" ? c("dim", JSON.stringify(a)) : a}`),
  error: (a, b) => console.error(c("red", "    × ") + `${b ?? ""} ${typeof a === "object" ? JSON.stringify(a) : a}`),
  warn:  (a, b) => warn(`${b ?? ""} ${typeof a === "object" ? JSON.stringify(a) : a}`),
};

const REPO_URL = process.env.DEMO_REPO || "https://github.com/Steven-wyf/axolotl-demo-app.git";
const RUN_ID   = Date.now();
const OUT_DIR  = path.join(os.homedir(), "Downloads");
const OUT_FILE = path.join(OUT_DIR, `axolotl-cloud-demo-${RUN_ID}.mp4`);
const LOG_FILE = path.join(OUT_DIR, `axolotl-cloud-run-${RUN_ID}.log`);

// ── The recorder script, uploaded into the sandbox via fs.write ──────────
const RECORDER_SRC = `
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRAME_DIR = '/tmp/frames';
const FPS = 10;
const FRAME_INTERVAL_MS = Math.round(1000 / FPS);
fs.mkdirSync(FRAME_DIR, { recursive: true });

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

let wsId = 0;
const pending = new Map();
function send(ws, method, params, sessionId) {
  const id = ++wsId;
  const msg = { id, method, params: params || {} };
  if (sessionId) msg.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(msg));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
    }, 15_000);
  });
}

async function main() {
  console.log('[recorder] fetching CDP root');
  const root = await fetchJson('http://localhost:9222/json/version');
  console.log('[recorder] browser = ' + root.Browser);
  const ws = new WebSocket(root.webSocketDebuggerUrl);
  await new Promise((r, e) => { ws.onopen = r; ws.onerror = () => e(new Error('ws open failed')); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  console.log('[recorder] creating target at http://localhost:3000');
  const target = await send(ws, 'Target.createTarget', { url: 'http://localhost:3000' });
  const tid = target.targetId;
  const attach = await send(ws, 'Target.attachToTarget', { targetId: tid, flatten: true });
  const sid = attach.sessionId;
  await send(ws, 'Page.enable', {}, sid);
  await send(ws, 'Runtime.enable', {}, sid);
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
  }, sid);
  await new Promise((r) => setTimeout(r, 800));

  let frameNum = 0;
  let capturing = true;
  let dropped = 0;
  const captureLoop = (async () => {
    while (capturing) {
      const t0 = Date.now();
      try {
        const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sid);
        if (shot && shot.data) {
          const buf = Buffer.from(shot.data, 'base64');
          fs.writeFileSync(path.join(FRAME_DIR, String(frameNum++).padStart(5, '0') + '.png'), buf);
        }
      } catch (e) { dropped++; }
      const wait = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
    }
  })();

  async function evalJs(expr) {
    return send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true }, sid);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('[recorder] beginning test flow');
  await wait(1500);

  // Step A: type bad credentials
  await evalJs(\`
    const u = document.querySelector('input[name="user"]');
    const p = document.querySelector('input[name="pass"]');
    u.focus(); u.value = 'alice';
    p.focus(); p.value = 'x';
  \`);
  await wait(1200);

  // Step B: signup → "Password too short"
  await evalJs(\`document.querySelector('button[formaction="/signup"]').click();\`);
  await wait(1800);

  // Step C: fix password
  await evalJs(\`
    const p = document.querySelector('input[name="pass"]');
    p.focus(); p.value = 'strongpassword123';
  \`);
  await wait(1200);

  // Step D: signup again → "Signed up"
  await evalJs(\`document.querySelector('button[formaction="/signup"]').click();\`);
  await wait(2200);

  // Step E: login
  await evalJs(\`
    const u = document.querySelector('input[name="user"]');
    const p = document.querySelector('input[name="pass"]');
    u.focus(); u.value = 'alice';
    p.focus(); p.value = 'strongpassword123';
  \`);
  await wait(1200);
  await evalJs(\`document.querySelector('button[formaction="/login"]').click();\`);
  await wait(2500);

  console.log('[recorder] test flow done, stopping capture');
  capturing = false;
  await captureLoop;

  const actualFrames = fs.readdirSync(FRAME_DIR).filter(f => f.endsWith('.png')).length;
  console.log('[recorder] captured ' + actualFrames + ' frames, dropped ' + dropped);
  fs.writeFileSync('/tmp/frame-count.txt', String(actualFrames));

  await send(ws, 'Target.closeTarget', { targetId: tid });
  ws.close();
}

main().then(() => { console.log('[recorder] DONE'); process.exit(0); })
      .catch((e) => { console.error('[recorder] FAIL: ' + (e?.stack || e)); process.exit(1); });
`;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // ── Opening curtain ────────────────────────────────────────────────
  console.log("");
  console.log(c("bold", "╔═══════════════════════════════════════════════════════════════╗"));
  console.log(c("bold", "║      ") + c("cyan", "AXOLOTL × BLAXEL — Test on Cloud pipeline") + c("bold", "               ║"));
  console.log(c("bold", "╠═══════════════════════════════════════════════════════════════╣"));
  console.log(c("bold", "║") + c("dim", " Demo repo: ") + REPO_URL.slice(0, 51).padEnd(51, " ") + c("bold", "  ║"));
  console.log(c("bold", "║") + c("dim", " Workspace: ") + (process.env.BL_WORKSPACE || "—").padEnd(51, " ") + c("bold", "  ║"));
  console.log(c("bold", "║") + c("dim", " Region:    ") + (process.env.BL_REGION || "us-pdx-1").padEnd(51, " ") + c("bold", "  ║"));
  console.log(c("bold", "╚═══════════════════════════════════════════════════════════════╝"));
  mark("run-start");

  // ── Stage 1: provision ──────────────────────────────────────────────
  stage("Provisioning Blaxel perpetual sandbox");
  info("Creating Alpine 3.23 sandbox with memory=4096MB, ports=[3000,5173,4321,9222,9223]");
  const pt0 = Date.now();
  const result = await provisionCloudRun({ repoUrl: REPO_URL, logger });
  mark("sandbox-ready", { sandboxName: result.sandboxName });
  done(`Sandbox ${c("bold", result.sandboxName)} provisioned in ${((Date.now() - pt0) / 1000).toFixed(1)}s`);
  done(`Framework detected: ${c("bold", result.framework)} on port ${result.appPortInSandbox}`);

  info("App preview URL:  " + c("blue", result.appUrl));
  info("CDP preview URL:  " + c("blue", result.cdpUrl));

  const sandbox = await SandboxInstance.get(result.sandboxName);

  // ── Stage 2: open the live app in Safari for evaluator to poke ─────
  stage("Opening LIVE app preview in Safari");
  info("Evaluators can interact with the app in real time while the test runs below");
  if (process.platform === "darwin") {
    spawn("open", ["-a", "Safari", result.appUrl], { detached: true, stdio: "ignore" }).unref();
    done("Safari opened at " + result.appUrl);
    mark("safari-opened");
  } else {
    warn("Non-macOS: open " + result.appUrl + " in your browser");
  }

  // ── Stage 3: install ffmpeg in the sandbox ─────────────────────────
  stage("Installing ffmpeg in sandbox (Alpine apk)");
  info("Runs `apk add --no-cache ffmpeg` via SDK runInSandbox workaround");
  const ffmpegStart = Date.now();
  const apk = await runInSandbox(sandbox, {
    name: "apk-ffmpeg",
    command: "sh -c 'apk add --no-cache ffmpeg 2>&1'",
    timeoutMs: 180_000,
  });
  if (apk.exitCode !== 0) {
    throw new Error("apk add ffmpeg failed: " + apk.stdout.slice(-300));
  }
  mark("ffmpeg-ready");
  done(`ffmpeg installed (${((Date.now() - ffmpegStart) / 1000).toFixed(1)}s)`);

  // ── Stage 4: upload recorder script ────────────────────────────────
  stage("Uploading recorder.js to /tmp/recorder.js");
  info("Pure Node.js recorder: CDP WebSocket + Runtime.evaluate + Page.captureScreenshot");
  await sandbox.fs.write("/tmp/recorder.js", RECORDER_SRC);
  mark("recorder-uploaded");
  done("recorder.js uploaded via sandbox.fs.write");

  // ── Stage 5: run recorder (driving form + capturing frames) ─────────
  stage("Driving login/signup form via CDP + capturing frames @ 10 FPS");
  info("Automated test flow: bad password → error → fix → success → login");
  const recStart = Date.now();
  const rec = await runInSandbox(sandbox, {
    name: "recorder",
    command: "sh -c 'cd /tmp && node recorder.js 2>&1'",
    timeoutMs: 60_000,
  });
  console.log(c("dim", rec.stdout.split("\n").map(l => "    │ " + l).join("\n")));
  if (rec.exitCode !== 0) {
    throw new Error("recorder failed: " + rec.stdout.slice(-500));
  }
  const frameCountMatch = rec.stdout.match(/captured (\d+) frames, dropped (\d+)/);
  const frameCount = frameCountMatch ? frameCountMatch[1] : "?";
  const droppedCount = frameCountMatch ? frameCountMatch[2] : "?";
  mark("frames-captured", { count: frameCount, dropped: droppedCount });
  done(`${c("bold", frameCount)} frames captured, ${droppedCount} dropped, ${((Date.now() - recStart) / 1000).toFixed(1)}s`);

  // ── Stage 6: ffmpeg encode frames into mp4 ──────────────────────────
  stage("Encoding frames to mp4 via ffmpeg libx264");
  const encStart = Date.now();
  const encode = await runInSandbox(sandbox, {
    name: "ffmpeg-encode",
    command:
      "sh -c 'ffmpeg -y -framerate 10 -i /tmp/frames/%05d.png " +
      "-c:v libx264 -preset ultrafast -pix_fmt yuv420p -vf \"scale=1280:-2\" " +
      "/tmp/demo.mp4 2>&1 || " +
      "ffmpeg -y -framerate 10 -i /tmp/frames/%05d.png -c:v mpeg4 -q:v 5 /tmp/demo.mp4 2>&1'",
    timeoutMs: 120_000,
  });
  if (encode.exitCode !== 0) {
    throw new Error("ffmpeg failed: " + encode.stdout.slice(-800));
  }
  const stat = await runInSandbox(sandbox, {
    name: "stat",
    command: "sh -c 'ls -la /tmp/demo.mp4 && stat -c %s /tmp/demo.mp4 2>/dev/null || wc -c < /tmp/demo.mp4'",
    timeoutMs: 10_000,
  });
  const sizeMatch = stat.stdout.match(/(\d+)\s*$/);
  const videoBytes = sizeMatch ? parseInt(sizeMatch[1], 10) : null;
  mark("mp4-encoded", { bytes: videoBytes });
  done(`mp4 encoded (${((Date.now() - encStart) / 1000).toFixed(1)}s, ${videoBytes ? (videoBytes / 1024).toFixed(1) + " KB" : "?"})`);

  // ── Stage 7: download the mp4 via in-sandbox HTTP server ───────────
  stage("Streaming mp4 home via in-sandbox HTTP server + public preview URL");
  info("Workaround: sandbox.fs.readBinary has an SDK event-loop bug on large files");
  const dlServerSrc = [
    "const http = require('http');",
    "const fs = require('fs');",
    "http.createServer((req, res) => {",
    "  try {",
    "    const s = fs.statSync('/tmp/demo.mp4');",
    "    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': s.size, 'Access-Control-Allow-Origin': '*' });",
    "    fs.createReadStream('/tmp/demo.mp4').pipe(res);",
    "  } catch (e) { res.writeHead(404); res.end(String(e.message)); }",
    "}).listen(5173, '0.0.0.0');",
  ].join("\n");
  await sandbox.fs.write("/tmp/dl-server.js", dlServerSrc);
  await startBackground(sandbox, {
    name: "dl-server-" + Date.now(),
    command: "node /tmp/dl-server.js",
    waitForPorts: [5173],
    timeoutMs: 20_000,
  });
  const dlUrl = await createPublicPreview(sandbox, 5173, "dl-" + Date.now());
  info("Download URL: " + c("blue", dlUrl));
  await new Promise((r) => setTimeout(r, 1500));

  const res2 = await fetch(dlUrl);
  if (!res2.ok) throw new Error("fetch failed: " + res2.status + " " + res2.statusText);
  const ab = await res2.arrayBuffer();
  const buf = Buffer.from(ab);
  fs.writeFileSync(OUT_FILE, buf);
  mark("mp4-downloaded", { bytes: buf.length });
  done(`${(buf.length / 1024).toFixed(1)} KB downloaded to ${c("bold", OUT_FILE)}`);

  // Verify mp4 magic bytes ("ftyp")
  const magic = buf.slice(4, 8).toString("ascii");
  if (magic === "ftyp") {
    done(`mp4 magic bytes verified: "ftyp" ✓`);
  } else {
    warn(`unexpected magic bytes: ${JSON.stringify(magic)}`);
  }

  // ── Stage 8: open the video ────────────────────────────────────────
  stage("Opening video in macOS default player");
  if (process.platform === "darwin") {
    spawn("open", [OUT_FILE], { detached: true, stdio: "ignore" }).unref();
    done("QuickTime / default player launched");
    mark("video-opened");
  } else {
    warn("Non-macOS: video saved to " + OUT_FILE);
  }

  // ── Final summary ──────────────────────────────────────────────────
  const totalSec = ((Date.now() - T0) / 1000).toFixed(1);
  console.log("");
  console.log(c("bold", "╔═══════════════════════════════════════════════════════════════╗"));
  console.log(c("bold", "║") + c("green", "          ✓ TEST-ON-CLOUD PIPELINE COMPLETE                    ") + c("bold", "║"));
  console.log(c("bold", "╠═══════════════════════════════════════════════════════════════╣"));
  console.log(c("bold", "║") + "  Total elapsed: " + c("bold", totalSec + "s").padEnd(55, " ") + c("bold", "║"));
  console.log(c("bold", "║") + "  Sandbox still alive (perpetual): " + c("dim", result.sandboxName.slice(0, 24)).padEnd(47, " ") + c("bold", "║"));
  console.log(c("bold", "╚═══════════════════════════════════════════════════════════════╝"));

  // Timeline table
  console.log("");
  console.log(c("bold", "  EXECUTION TIMELINE"));
  console.log("  ─────────────────────────────────────────────────────────────");
  for (const e of timeline) {
    const tt = `t+${String(e.t).padStart(5, " ")}s`;
    console.log("  " + c("cyan", tt) + "  " + e.label);
  }

  console.log("");
  console.log(c("bold", "  ARTIFACTS"));
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log("  Video:   " + OUT_FILE);
  console.log("  Run log: " + LOG_FILE);
  console.log("  App URL: " + c("blue", result.appUrl) + c("dim", "   (live, click to interact)"));
  console.log("  CDP URL: " + c("blue", result.cdpUrl) + c("dim", "   (real Chromium DevTools)"));
  console.log("");

  // Write the run log to ~/Downloads for posterity / slide screenshot
  const logLines = [
    `AXOLOTL × BLAXEL — Test on Cloud run`,
    `====================================`,
    `Run ID:    ${RUN_ID}`,
    `Repo:      ${REPO_URL}`,
    `Workspace: ${process.env.BL_WORKSPACE}`,
    `Region:    ${process.env.BL_REGION || "us-pdx-1"}`,
    `Sandbox:   ${result.sandboxName}`,
    `Framework: ${result.framework}`,
    `App port:  ${result.appPortInSandbox}`,
    `App URL:   ${result.appUrl}`,
    `CDP URL:   ${result.cdpUrl}`,
    `Video:     ${OUT_FILE} (${buf.length} bytes)`,
    `Total:     ${totalSec}s`,
    ``,
    `Timeline:`,
    ...timeline.map((e) => `  t+${e.t}s  ${e.label}${e.extra ? " " + JSON.stringify(e.extra) : ""}`),
  ];
  fs.writeFileSync(LOG_FILE, logLines.join("\n") + "\n");
  done(`Timeline log written to ${LOG_FILE}`);

  console.log("");
  console.log(c("dim", "  To clean up the sandbox later:"));
  console.log(c("dim", `    node -e "(await import('@blaxel/core')).SandboxInstance.delete('${result.sandboxName}')"`));
  console.log("");
}

main().catch((err) => {
  console.error("");
  console.error(c("red", "╔═══════════════════════════════════════════════════════════════╗"));
  console.error(c("red", "║                TEST-ON-CLOUD PIPELINE FAILED                  ║"));
  console.error(c("red", "╚═══════════════════════════════════════════════════════════════╝"));
  console.error("");
  console.error(err?.stack || err);
  process.exit(1);
});
