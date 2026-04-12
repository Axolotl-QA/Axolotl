import { SandboxInstance } from "@blaxel/core";
import { runInSandbox, startBackground, createPublicPreview, safeDeleteSandbox } from "./blaxel/sandboxClient.js";

const name = `diag-${Date.now()}`;
const sb = await SandboxInstance.create({
  name, region: "us-pdx-1", memory: 2048,
  ports: [{ name: "cdp", target: 9222, protocol: "HTTP" }],
}, { safe: true });
console.log("sandbox ready");

await runInSandbox(sb, { name: "apk", command: "sh -c 'apk add --no-cache chromium 2>&1'", timeoutMs: 180_000 });
console.log("apk done");

console.log("checking chromium version...");
const ver = await runInSandbox(sb, { name: "ver", command: "sh -c 'chromium --version 2>&1'", timeoutMs: 15_000 });
console.log("chromium --version:", ver.stdout, "exit:", ver.exitCode);

console.log("starting chromium in background via sh -c 'chromium ... &'...");
await startBackground(sb, {
  name: "chromium",
  command:
    "sh -c 'chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage " +
    "--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 " +
    "--user-data-dir=/tmp/chrome-profile --no-first-run --no-default-browser-check " +
    "about:blank > /tmp/chrome.log 2>&1 & echo started; sleep 60; echo slept'",
  waitForPorts: [9222],
  timeoutMs: 60_000,
});
console.log("waitForPorts returned");

// Check if chromium is actually listening
const ps = await runInSandbox(sb, {
  name: "ps",
  command: "sh -c 'ps -ef | grep chromium | grep -v grep; echo ---; ss -tlnp 2>/dev/null || netstat -tln 2>/dev/null; echo ---; cat /tmp/chrome.log 2>/dev/null | tail -30'",
  timeoutMs: 15_000,
});
console.log("ps + netstat + chrome.log:");
console.log(ps.stdout);

// Try curl inside sandbox
const localCurl = await runInSandbox(sb, {
  name: "curl-local",
  command: "sh -c 'apk add --no-cache curl >/dev/null 2>&1; curl -sSv http://localhost:9222/json/version 2>&1 | head -30'",
  timeoutMs: 15_000,
});
console.log("local curl:");
console.log(localCurl.stdout);

// Create preview and curl externally
const preview = await createPublicPreview(sb, 9222, "diag-preview");
console.log("preview URL:", preview);
console.log("external curl:");
const r = await fetch(`${preview}/json/version`);
console.log("status:", r.status);
console.log("body:", await r.text());

await safeDeleteSandbox(name);
