import { SandboxInstance } from "@blaxel/core";
import { runInSandbox, safeDeleteSandbox } from "../blaxel/sandboxClient.js";
import fs from "node:fs";
const LOG = "/tmp/net-probe.log";
fs.writeFileSync(LOG, "");
const d = (m) => { const l = `[${new Date().toISOString()}] ${m}\n`; fs.appendFileSync(LOG, l); process.stdout.write(l); };
process.on("exit", (c) => { try { fs.appendFileSync(LOG, `EXIT ${c}\n`); } catch {} });

const name = `net-probe-${Date.now()}`;
let sb;
try {
  d("create sandbox");
  sb = await SandboxInstance.create({ name, region: "us-pdx-1", memory: 2048, ports: [{ name: "cdp", target: 9222, protocol: "HTTP" }] }, { safe: true });
  d("installing curl + git");
  const instr = await runInSandbox(sb, { name: "apk", command: "sh -c 'apk add --no-cache curl git ca-certificates 2>&1'", timeoutMs: 180_000 });
  d(`apk exit=${instr.exitCode}`);
  d("curl github.com/vitejs/create-vite");
  const c1 = await runInSandbox(sb, { name: "curl1", command: "sh -c 'curl -sSI -L https://github.com/vitejs/create-vite 2>&1 | head -10'", timeoutMs: 30_000 });
  d(`curl1 exit=${c1.exitCode}\n${c1.stdout}`);
  d("git clone direct");
  const c2 = await runInSandbox(sb, { name: "clone", command: "sh -c 'GIT_TERMINAL_PROMPT=0 git clone --depth 1 https://github.com/vitejs/create-vite.git /tmp/test 2>&1'", timeoutMs: 60_000 });
  d(`clone exit=${c2.exitCode}\n${c2.stdout}`);
  d("try smaller repo");
  const c3 = await runInSandbox(sb, { name: "clone2", command: "sh -c 'GIT_TERMINAL_PROMPT=0 git clone --depth 1 https://github.com/tj/commander.js.git /tmp/cj 2>&1'", timeoutMs: 60_000 });
  d(`clone2 exit=${c3.exitCode}\n${c3.stdout}`);
  d("cat /etc/resolv.conf");
  const c4 = await runInSandbox(sb, { name: "dns", command: "sh -c 'cat /etc/resolv.conf; echo ---; nslookup github.com 2>&1 || getent hosts github.com 2>&1'", timeoutMs: 10_000 });
  d(`dns:\n${c4.stdout}`);
} catch (e) {
  d(`ERR: ${e?.stack || e}`);
} finally {
  d("cleanup");
  await safeDeleteSandbox(name);
}
process.exit(0);
