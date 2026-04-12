// Workaround for SDK bugs in fs.download / fs.readBinary / process.logs on large
// outputs: start a tiny HTTP file server inside the sandbox on port 5173
// (already declared in provisionCloudRun), create a public preview URL,
// then download via plain fetch() on the host side.
import { SandboxInstance } from "@blaxel/core";
import { startBackground, createPublicPreview } from "./blaxel/sandboxClient.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const NAME = process.argv[2];
const REMOTE = process.argv[3] || "/tmp/demo.mp4";
if (!NAME) {
  console.error("usage: node download-via-http.mjs <sandboxName> [remotePath]");
  process.exit(2);
}
const OUT = path.join(os.homedir(), "Downloads", `axolotl-cloud-demo-${Date.now()}.mp4`);

const sb = await SandboxInstance.get(NAME);
console.log(`attached to ${NAME}`);

// Upload a minimal Node file server that serves exactly REMOTE as /file
const serverSrc = `
const http = require('http');
const fs = require('fs');
const FILE = ${JSON.stringify(REMOTE)};
const PORT = 5173;
http.createServer((req, res) => {
  try {
    const stat = fs.statSync(FILE);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="demo.mp4"',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(FILE).pipe(res);
  } catch (e) {
    res.writeHead(404); res.end(String(e.message));
  }
}).listen(PORT, '0.0.0.0', () => console.log('download server on ' + PORT));
`;
console.log(`uploading download-server.js to sandbox`);
await sb.fs.write("/tmp/download-server.js", serverSrc);

console.log(`starting download server on :5173`);
// Use unique name so re-runs don't collide
const procName = "dl-server-" + Date.now();
await startBackground(sb, {
  name: procName,
  command: "node /tmp/download-server.js",
  waitForPorts: [5173],
  timeoutMs: 20_000,
});

console.log(`creating public preview URL for :5173`);
const dlUrl = await createPublicPreview(sb, 5173, "dl-preview-" + Date.now());
console.log(`download URL: ${dlUrl}`);

// Give the preview URL a moment to propagate
await new Promise((r) => setTimeout(r, 1500));

console.log(`fetching ${dlUrl}/file`);
const res = await fetch(dlUrl);
if (!res.ok) {
  throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
}
const ab = await res.arrayBuffer();
const buf = Buffer.from(ab);
console.log(`got ${buf.length} bytes`);

fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT}`);

// Verify first bytes of mp4 (ftyp box)
const header = buf.slice(0, 16).toString("hex");
console.log(`header (hex): ${header}`);
const ascii = buf.slice(4, 12).toString("ascii");
console.log(`bytes 4-12 (ascii): ${JSON.stringify(ascii)}`);

if (process.platform === "darwin") {
  spawn("open", [OUT], { detached: true, stdio: "ignore" }).unref();
  console.log("opened with macOS default player");
}
process.exit(0);
