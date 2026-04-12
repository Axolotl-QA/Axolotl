// Workaround: fs.readBinary() hangs silently (SDK event-loop bug). Use
// runInSandbox to run `base64 /tmp/demo.mp4` and decode the stdout locally.
import { SandboxInstance } from "@blaxel/core";
import { runInSandbox } from "./blaxel/sandboxClient.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const NAME = process.argv[2];
const REMOTE = process.argv[3] || "/tmp/demo.mp4";
if (!NAME) {
  console.error("usage: node download-via-base64.mjs <sandboxName> [remotePath]");
  process.exit(2);
}
const OUT = path.join(os.homedir(), "Downloads", `axolotl-cloud-demo-${Date.now()}.mp4`);

console.log(`attaching to ${NAME}`);
const sb = await SandboxInstance.get(NAME);

console.log(`checking remote file exists`);
const stat = await runInSandbox(sb, {
  name: "stat-" + Date.now(),
  command: `sh -c 'ls -la ${REMOTE} 2>&1 && stat -c %s ${REMOTE} 2>/dev/null || wc -c < ${REMOTE}'`,
  timeoutMs: 10_000,
});
console.log("  " + stat.stdout);

console.log(`base64-encoding remote file to stdout`);
// busybox base64 on Alpine: just `base64 <file>` (no -w flag support)
const enc = await runInSandbox(sb, {
  name: "b64-" + Date.now(),
  command: `sh -c 'base64 ${REMOTE}'`,
  timeoutMs: 60_000,
});
if (enc.exitCode !== 0) {
  throw new Error("base64 failed: " + enc.stderr || enc.stdout.slice(-200));
}
// Strip whitespace/newlines that busybox inserts
const b64 = enc.stdout.replace(/\s+/g, "");
console.log(`  got ${b64.length} base64 chars (${Math.round(b64.length / 4 * 3)} decoded bytes expected)`);

const buf = Buffer.from(b64, "base64");
console.log(`  decoded to ${buf.length} bytes`);
fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT}`);

// Sanity: first 8 bytes of an mp4 should include "ftyp"
const header = buf.slice(0, 16).toString("ascii");
console.log(`  file header: ${JSON.stringify(header)}`);

if (process.platform === "darwin") {
  spawn("open", [OUT], { detached: true, stdio: "ignore" }).unref();
  console.log("opened with macOS default player");
}
process.exit(0);
