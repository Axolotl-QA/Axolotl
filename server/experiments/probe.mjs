import { SandboxInstance } from "@blaxel/core";
import fs from "node:fs";

const LOG = "/tmp/apk-probe.log";
fs.writeFileSync(LOG, `START ${new Date().toISOString()}\n`);
const d = (m) => { const l = `[${new Date().toISOString()}] ${m}\n`; fs.appendFileSync(LOG, l); process.stdout.write(l); };

// Keep event loop alive so we can see pending promises resolve
const heartbeat = setInterval(() => d("heartbeat"), 5000);

process.on("beforeExit", (c) => d(`beforeExit ${c}`));
process.on("exit", (c) => { try { fs.appendFileSync(LOG, `EXIT ${c}\n`); } catch {} });

const { BL_WORKSPACE, BL_API_KEY } = process.env;
d(`env ok: ws=${BL_WORKSPACE} key=${BL_API_KEY?.slice(0,10)}...`);

const name = `probe-${Date.now()}`;

(async () => {
  d("creating sandbox");
  const sb = await SandboxInstance.create({
    name, region: "us-pdx-1", memory: 2048,
    ports: [{ name: "cdp", target: 9222, protocol: "HTTP" }],
  }, { safe: true });
  d(`sandbox created: ${name}`);
  d(`sb.process type: ${typeof sb.process}`);
  d(`sb.process.exec type: ${typeof sb.process?.exec}`);

  d("calling exec with tiny command (no shell, no waitForCompletion)");
  const p = sb.process.exec({
    name: "echo-test",
    command: "/bin/echo hello",
    waitForCompletion: false,
  });
  d(`exec returned: ${typeof p} / isPromise=${p && typeof p.then === 'function'}`);
  
  p.then(v => d(`exec PROMISE RESOLVED: ${JSON.stringify(v).slice(0, 200)}`))
   .catch(e => d(`exec PROMISE REJECTED: ${e?.message || e}`));

  // Give it 20 seconds to resolve
  await new Promise(r => setTimeout(r, 20000));
  d("20s elapsed, cleaning up");

  try { await SandboxInstance.delete(name); d("deleted"); } catch (e) { d(`delete err: ${e?.message}`); }
  clearInterval(heartbeat);
  d("DONE");
})().catch(e => { d(`TOP LEVEL REJECT: ${e?.stack || e}`); clearInterval(heartbeat); process.exit(1); });
