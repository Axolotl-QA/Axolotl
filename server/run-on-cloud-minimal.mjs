// Minimal Run-on-Cloud: provision a Blaxel sandbox with just headless Chromium.
// No repo, no framework detection — just "give me a remote browser in the cloud".
// Usage: node run-on-cloud-minimal.mjs
//
// Returns a CDP preview URL you can plug into Axolotl's remoteBrowserHost.
// Axolotl's agent can then tell that Chromium to navigate ANY URL.
import { SandboxInstance } from "@blaxel/core";
import {
  runInSandbox,
  startBackground,
  createPublicPreview,
} from "./blaxel/sandboxClient.js";

const { BL_WORKSPACE, BL_API_KEY } = process.env;
if (!BL_WORKSPACE || !BL_API_KEY) {
  console.error("Missing BL_WORKSPACE or BL_API_KEY");
  process.exit(2);
}

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const logger = { info: (a, b) => log(`${b ?? ""} ${typeof a === "object" ? JSON.stringify(a) : a}`) };

const name = `axolotl-chrome-${Date.now()}`;
const t0 = Date.now();

log(`Creating sandbox ${name}...`);
const sandbox = await SandboxInstance.create(
  {
    name,
    region: process.env.BL_REGION || "us-pdx-1",
    memory: 2048,
    ports: [{ name: "cdp", target: 9222, protocol: "HTTP" }],
  },
  { safe: true },
);
log("Sandbox ready");

log("apk add chromium (Alpine musl-native Chromium)...");
const apk = await runInSandbox(sandbox, {
  name: "apk",
  command: "sh -c 'apk add --no-cache chromium 2>&1'",
  timeoutMs: 300_000,
});
if (apk.exitCode !== 0) {
  console.error("apk failed:", apk.stdout.slice(-300));
  process.exit(1);
}
log("Chromium installed");

log("Starting headless Chromium with --remote-debugging-port=9222...");
await startBackground(sandbox, {
  name: "chromium",
  command:
    "chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage " +
    "--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 " +
    "--user-data-dir=/tmp/chrome-profile about:blank",
  waitForPorts: [9222],
  timeoutMs: 60_000,
});
log("Chromium running on 9222");

log("Creating public CDP preview URL...");
const cdpUrl = await createPublicPreview(sandbox, 9222, "cdp-preview");

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log("");
console.log("==============================================================");
console.log(`  READY in ${elapsed}s`);
console.log("==============================================================");
console.log(`  sandboxName = ${name}`);
console.log(`  cdpUrl      = ${cdpUrl}`);
console.log("");
console.log("Verification:");
console.log(`  curl ${cdpUrl}/json/version   # should return HeadlessChrome/...`);
console.log("");
console.log("Axolotl integration:");
console.log("  1. Open Axolotl extension settings → Browser");
console.log(`  2. Enable 'Use remote browser' and set host to: ${cdpUrl}`);
console.log("  3. Start any task that asks the agent to visit a URL");
console.log("  4. BrowserSession will connect to Chromium IN BLAXEL via CDP tunnel");
console.log("");
console.log("Sandbox auto-suspends after 15s idle; resumes in ~25ms on next access.");
console.log("Delete when done: npm run blaxel:delete -- " + name);
process.exit(0);
