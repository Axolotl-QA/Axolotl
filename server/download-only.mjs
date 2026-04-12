// Minimal: attach to an already-provisioned sandbox and download /tmp/demo.mp4
// via readBinary (avoids the potential SDK bug in fs.download).
import { SandboxInstance } from "@blaxel/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const NAME = process.argv[2] || "axolotl-1775947481335";
const OUT = path.join(os.homedir(), "Downloads", `axolotl-cloud-demo-${Date.now()}.mp4`);

console.log(`attaching to ${NAME}`);
const sb = await SandboxInstance.get(NAME);
console.log(`reading /tmp/demo.mp4 via readBinary...`);
const blob = await sb.fs.readBinary("/tmp/demo.mp4");
console.log(`blob type: ${typeof blob}, constructor: ${blob?.constructor?.name}`);

// Try several ways to get bytes out of the blob
let buf;
if (blob instanceof Uint8Array) {
  buf = Buffer.from(blob);
} else if (blob && typeof blob.arrayBuffer === "function") {
  const ab = await blob.arrayBuffer();
  buf = Buffer.from(ab);
} else if (Buffer.isBuffer(blob)) {
  buf = blob;
} else if (blob && blob.data) {
  buf = Buffer.from(blob.data);
} else {
  console.log("unknown blob shape, logging:");
  console.log(Object.keys(blob || {}));
  throw new Error("cannot convert readBinary result to buffer");
}
console.log(`got ${buf.length} bytes`);
fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT}`);

if (process.platform === "darwin") {
  spawn("open", [OUT], { detached: true, stdio: "ignore" }).unref();
  console.log("opened with default macOS player");
}
process.exit(0);
