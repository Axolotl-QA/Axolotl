/**
 * Blaxel Smoke Test — v3 (fake-CDP approach)
 *
 * Purpose: validate the NETWORK LAYER (preview URL proxy to sandbox ports,
 * including WebSocket upgrade). Does NOT actually need real Chromium —
 * we upload a tiny fake-CDP server to the sandbox and verify:
 *   1. HTTP GET /json/version through HTTPS preview URL
 *   2. WebSocket upgrade + CDP command round-trip through WSS preview URL
 *
 * If both pass, we know Blaxel preview URLs proxy HTTP + WS correctly,
 * which is the only unknown for our main architecture.
 *
 * NOTE: Every sandbox.process.exec(...) here is a Blaxel SDK call
 * that runs the command INSIDE the remote sandbox. Not Node's child_process.exec.
 */

import { SandboxInstance } from "@blaxel/core";
import WebSocket from "ws";

const { BL_WORKSPACE, BL_API_KEY } = process.env;
if (!BL_WORKSPACE || !BL_API_KEY) {
  console.error("Missing BL_WORKSPACE or BL_API_KEY env vars");
  process.exit(2);
}

const SANDBOX_NAME = `axolotl-smoke-${Date.now()}`;
const REGION = process.env.BL_REGION || "us-pdx-1";

const log = (p, m) => console.log(`[${p}] ${m}`);
const ok = (p, m) => console.log(`[${p}] OK  ${m}`);

let sandbox = null;

async function cleanup(reason = "cleanup") {
  if (!sandbox) return;
  try {
    log("3.1", `Deleting sandbox (${reason})...`);
    await SandboxInstance.delete(SANDBOX_NAME);
    ok("3.1", "Sandbox deleted");
  } catch (e) {
    console.error("[3.1] FAIL delete:", e?.message || e);
  }
}
process.on("SIGINT", async () => { await cleanup("SIGINT"); process.exit(130); });

// Minimal fake CDP server (pure Node builtins, no deps).
// Responds to GET /json/version with CDP-shaped JSON,
// and accepts WebSocket upgrades at /devtools/browser/fake,
// echoing a fake Target.getTargets response.
const FAKE_CDP_SOURCE = String.raw`
const http = require('http');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
  if (req.url === '/json/version' || req.url === '/json/version/') {
    const host = req.headers.host;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      Browser: 'FakeChromium/999.0',
      'Protocol-Version': '1.3',
      webSocketDebuggerUrl: 'ws://' + host + '/devtools/browser/fake-uuid',
    }));
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.on('data', (buf) => {
    try {
      if (buf.length < 2) return;
      const b2 = buf[1];
      const masked = (b2 & 0x80) !== 0;
      let payloadLen = b2 & 0x7f;
      let offset = 2;
      if (payloadLen === 126) { payloadLen = buf.readUInt16BE(2); offset = 4; }
      else if (payloadLen === 127) { payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10; }
      let mask = null;
      if (masked) { mask = buf.slice(offset, offset + 4); offset += 4; }
      const payload = buf.slice(offset, offset + payloadLen);
      const decoded = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) decoded[i] = payload[i] ^ (mask ? mask[i % 4] : 0);
      let cmd; try { cmd = JSON.parse(decoded.toString('utf8')); } catch { return; }
      if (cmd && cmd.method === 'Target.getTargets' && cmd.id != null) {
        const resp = JSON.stringify({
          id: cmd.id,
          result: { targetInfos: [{ targetId: 'fake-1', type: 'browser', title: 'Fake', url: 'about:blank', attached: false }] },
        });
        const data = Buffer.from(resp);
        let frame;
        if (data.length < 126) frame = Buffer.concat([Buffer.from([0x81, data.length]), data]);
        else frame = Buffer.concat([Buffer.from([0x81, 126, (data.length >> 8) & 0xff, data.length & 0xff]), data]);
        socket.write(frame);
      }
    } catch (e) { console.error('ws err', e); }
  });
});

server.listen(9222, '0.0.0.0', () => console.log('fake-cdp listening 9222'));
`;

async function main() {
  log("1.1", `Creating sandbox "${SANDBOX_NAME}" in region ${REGION} with ports [8000, 9222]...`);
  sandbox = await SandboxInstance.create(
    {
      name: SANDBOX_NAME,
      region: REGION,
      memory: 2048,
      // Use default base image (has Node); we'll upload our own script.
      ports: [
        { name: "http-test", target: 8000 },
        { name: "cdp", target: 9222, protocol: "HTTP" },
      ],
    },
    { safe: true },
  );
  ok("1.1", "Sandbox created and warmed up");

  log("1.2", "Starting node http server on :8000...");
  await sandbox.process.exec({
    name: "http-server",
    command:
      `node -e "require('http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>BLAXEL SMOKE OK</h1>')}).listen(8000,'0.0.0.0',()=>console.log('listening 8000'))"`,
    waitForCompletion: false,
    waitForPorts: [8000],
  });
  ok("1.2", "node http server running on :8000");

  log("1.4", "Creating PUBLIC preview URL for port 8000...");
  const httpPreview = await sandbox.previews.create({
    metadata: { name: "http-preview" },
    spec: { port: 8000, public: true },
  });
  const httpUrl = httpPreview.spec?.url;
  if (!httpUrl) throw new Error("Preview created but spec.url is missing");
  ok("1.4", `Preview URL: ${httpUrl}`);

  log("1.5", `Fetching ${httpUrl}/ ...`);
  await new Promise(r => setTimeout(r, 2000));
  const httpRes = await fetch(httpUrl, { redirect: "follow" });
  const httpBody = await httpRes.text();
  if (!httpRes.ok || !httpBody.includes("BLAXEL SMOKE OK")) {
    throw new Error(`Phase 1.5 FAILED: status=${httpRes.status}, body=${httpBody.slice(0, 200)}`);
  }
  ok("1.5", "HTTP round-trip through preview URL works");

  // ── PHASE 2: fake CDP server for WS validation ──
  log("2.1", "Uploading fake-cdp.js to sandbox via filesystem API...");
  await sandbox.fs.write("/tmp/fake-cdp.js", FAKE_CDP_SOURCE);
  ok("2.1", "fake-cdp.js uploaded to /tmp/fake-cdp.js");

  log("2.2", "Starting fake CDP server on :9222...");
  await sandbox.process.exec({
    name: "fake-cdp",
    command: "node /tmp/fake-cdp.js",
    waitForCompletion: false,
    waitForPorts: [9222],
    keepAlive: true,
  });
  ok("2.2", "fake CDP server running on :9222");

  log("2.4", "Creating public preview URL for port 9222 (CDP)...");
  const cdpPreview = await sandbox.previews.create({
    metadata: { name: "cdp-preview" },
    spec: { port: 9222, public: true },
  });
  const cdpUrl = cdpPreview.spec?.url;
  if (!cdpUrl) throw new Error("CDP preview created but spec.url is missing");
  ok("2.4", `CDP preview URL: ${cdpUrl}`);

  log("2.5", `Fetching ${cdpUrl}/json/version ...`);
  await new Promise(r => setTimeout(r, 2000));
  const versionRes = await fetch(`${cdpUrl}/json/version`, { redirect: "follow" });
  if (!versionRes.ok) {
    throw new Error(`Phase 2.5 FAILED: GET /json/version -> status ${versionRes.status}`);
  }
  const version = await versionRes.json();
  ok("2.5", `HTTP round-trip to :9222 works. Browser: ${version.Browser}`);
  const originalWsUrl = version.webSocketDebuggerUrl;
  if (!originalWsUrl) throw new Error("Phase 2.5 FAILED: no webSocketDebuggerUrl");
  log("2.5", `  fake-cdp reports WS URL = ${originalWsUrl}`);

  const previewOrigin = new URL(cdpUrl);
  const wsScheme = previewOrigin.protocol === "https:" ? "wss:" : "ws:";
  const originalPath = new URL(originalWsUrl).pathname;
  const rewrittenWsUrl = `${wsScheme}//${previewOrigin.host}${originalPath}`;
  log("2.6", `Rewrote WS URL -> ${rewrittenWsUrl}`);
  log("2.6", "Opening WebSocket upgrade request...");

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(rewrittenWsUrl, { handshakeTimeout: 15_000 });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WS timeout after 20s")); }, 20_000);
    ws.on("open", () => {
      log("2.6", "  WS connected (101 upgrade succeeded), sending Target.getTargets...");
      ws.send(JSON.stringify({ id: 1, method: "Target.getTargets" }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        const targets = msg.result?.targetInfos;
        if (!targets) reject(new Error(`WS response had no result: ${data}`));
        else { ok("2.6", `WS round-trip works (${targets.length} fake targets)`); resolve(); }
      }
    });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });

  console.log("");
  console.log("==============================================================");
  console.log("  ALL PHASES PASSED -- Main architecture is GO");
  console.log("==============================================================");
  console.log("  + Sandbox with multiple exposed ports");
  console.log("  + Long-lived background processes");
  console.log("  + Filesystem API for uploading script files");
  console.log("  + Public preview URLs with HTTP round-trip (port 8000)");
  console.log("  + Public preview URLs with HTTP round-trip (port 9222)");
  console.log("  + WebSocket upgrade + message round-trip through WSS preview");
  console.log("");
  console.log("-> Preview URL proxy supports HTTP *and* WebSocket upgrade.");
  console.log("-> Axolotl's BrowserSession.remoteBrowserHost will work once we");
  console.log("   run a real Chromium in a custom Blaxel sandbox template.");
  console.log("==============================================================");
}

main()
  .then(async () => { await cleanup("success"); process.exit(0); })
  .catch(async (err) => {
    console.error("");
    console.error("==============================================================");
    console.error("  SMOKE TEST FAILED");
    console.error("==============================================================");
    console.error(err instanceof Error ? err.stack : err);
    await cleanup("failure");
    process.exit(1);
  });
