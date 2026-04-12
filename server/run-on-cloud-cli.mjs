// Minimal Run-on-Cloud CLI for the hackathon demo.
// Usage: node run-on-cloud-cli.mjs <repoUrl> [testingFocus]
// Skips Fastify + auth — calls provisionCloudRun directly.
import { provisionCloudRun } from "./blaxel/sandboxRunner.js";

const [, , repoUrl, ...focusParts] = process.argv;
if (!repoUrl) {
  console.error("usage: node run-on-cloud-cli.mjs <repoUrl> [testing focus]");
  process.exit(2);
}
const testingFocus = focusParts.join(" ") || "";

// Tiny pino-shim logger — sandboxRunner expects logger.info({}, msg) shape.
const logger = {
  info:  (a, b) => console.log(`[info ] ${b ?? ""}${typeof a === "object" ? " " + JSON.stringify(a) : " " + a}`),
  error: (a, b) => console.error(`[error] ${b ?? ""}${typeof a === "object" ? " " + JSON.stringify(a) : " " + a}`),
  warn:  (a, b) => console.warn(`[warn ] ${b ?? ""}${typeof a === "object" ? " " + JSON.stringify(a) : " " + a}`),
};

const { BL_WORKSPACE, BL_API_KEY } = process.env;
if (!BL_WORKSPACE || !BL_API_KEY) {
  console.error("Missing BL_WORKSPACE or BL_API_KEY");
  process.exit(2);
}

console.log(`=== Run on Cloud ===`);
console.log(`repo: ${repoUrl}`);
console.log(`focus: ${testingFocus || "(none)"}\n`);
const t0 = Date.now();

try {
  const result = await provisionCloudRun({ repoUrl, logger });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("");
  console.log("==============================================================");
  console.log(`  PROVISIONED in ${elapsed}s`);
  console.log("==============================================================");
  console.log(`  sandboxName         = ${result.sandboxName}`);
  console.log(`  framework           = ${result.framework}`);
  console.log(`  appPortInSandbox    = ${result.appPortInSandbox}`);
  console.log(`  appUrl  (user app)  = ${result.appUrl}`);
  console.log(`  cdpUrl  (Chromium)  = ${result.cdpUrl}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Open ${result.appUrl} in a browser — this is the user's app running in Blaxel`);
  console.log(`  2. curl ${result.cdpUrl}/json/version  — confirms real Chromium via CDP`);
  console.log(`  3. In Axolotl: set remoteBrowserHost=${result.cdpUrl} and start a task`);
  console.log("");
  console.log(`Sandbox auto-suspends in 15s; auto-resumes in 25ms on next access.`);
  process.exit(0);
} catch (err) {
  console.error("");
  console.error("FAILED:", err?.message || err);
  process.exit(1);
}
