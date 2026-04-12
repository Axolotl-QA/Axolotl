// server/blaxel/sandboxRunner.js
// Single-file MVP: provision a Blaxel sandbox for a GitHub repo + headless Chromium.
// Returns { sandboxName, appUrl, cdpUrl, framework, appPortInSandbox }.
import { SandboxInstance } from "@blaxel/core";
import {
  runInSandbox,
  startBackground,
  createPublicPreview,
  safeDeleteSandbox,
} from "./sandboxClient.js";

const CHROMIUM_CDP_PORT = 9222;
const CDP_PROXY_PORT = 9223;  // Node proxy that rewrites Host header before forwarding to Chromium

const FRAMEWORK_HINTS = [
  { dep: "next",          cmd: "npm run dev", port: 3000 },
  { dep: "vite",          cmd: "npm run dev", port: 5173 },
  { dep: "react-scripts", cmd: "npm start",   port: 3000 },
  { dep: "astro",         cmd: "npm run dev", port: 4321 },
];



// Tiny Node HTTP + WebSocket proxy that sits in front of Chromium's DevTools.
// Reason: Chromium's DevTools HTTP server rejects any request whose Host
// header isn't localhost. When Blaxel's preview URL proxies an inbound
// request, the Host header becomes "<hash>.preview.bl.run" and Chromium 502s.
// This tiny proxy listens on 9223, rewrites Host to "localhost:9222", then
// pipes the request to Chromium. It also handles WebSocket upgrades.
const CDP_PROXY_SOURCE = `
const http = require('http');
const net = require('net');
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 9222;
const LISTEN_PORT = 9223;

const server = http.createServer((req, res) => {
  req.headers.host = 'localhost:' + UPSTREAM_PORT;
  const opts = {
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const upstream = http.request(opts, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => { console.error('upstream err', e.message); res.writeHead(502); res.end(); });
  req.pipe(upstream);
});

server.on('upgrade', (req, clientSock, head) => {
  req.headers.host = 'localhost:' + UPSTREAM_PORT;
  const upstreamSock = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    // Re-send the raw upgrade request with rewritten headers
    let headerLines = [req.method + ' ' + req.url + ' HTTP/1.1'];
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) for (const vv of v) headerLines.push(k + ': ' + vv);
      else headerLines.push(k + ': ' + v);
    }
    headerLines.push('', '');
    upstreamSock.write(headerLines.join('\\r\\n'));
    if (head && head.length) upstreamSock.write(head);
    upstreamSock.pipe(clientSock);
    clientSock.pipe(upstreamSock);
  });
  upstreamSock.on('error', (e) => { console.error('upgrade upstream err', e.message); clientSock.destroy(); });
  clientSock.on('error', () => upstreamSock.destroy());
});

server.listen(LISTEN_PORT, '0.0.0.0', () => console.log('cdp-proxy listening on ' + LISTEN_PORT));
`;

export function detectFramework(packageJson) {
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  for (const hint of FRAMEWORK_HINTS) {
    if (hint.dep in deps) return { name: hint.dep, cmd: hint.cmd, port: hint.port };
  }
  if (packageJson.scripts?.dev)   return { name: "unknown", cmd: "npm run dev", port: 3000 };
  if (packageJson.scripts?.start) return { name: "unknown", cmd: "npm start",   port: 3000 };
  return null;
}

export async function provisionCloudRun({ repoUrl, logger }) {
  const sandboxName = `axolotl-${Date.now()}`;
  logger.info({ sandboxName, repoUrl }, "Provisioning Blaxel sandbox");

  const sandbox = await SandboxInstance.create(
    {
      name: sandboxName,
      region: process.env.BL_REGION || "us-pdx-1",
      memory: 4096,
      ports: [
        { name: "app3000", target: 3000 },
        { name: "app5173", target: 5173 },
        { name: "app4321", target: 4321 },
        { name: "cdp",     target: CHROMIUM_CDP_PORT, protocol: "HTTP" },
        { name: "cdpx",    target: CDP_PROXY_PORT,  protocol: "HTTP" },
      ],
    },
    { safe: true },
  );
  logger.info("Sandbox created");

  try {
    logger.info("apk add chromium + git");
    const apk = await runInSandbox(sandbox, {
      name: "apk-install",
      command: "sh -c 'apk add --no-cache chromium git 2>&1'",
      timeoutMs: 300_000,
    });
    if (apk.exitCode !== 0) {
      throw new Error(`apk add failed (exit ${apk.exitCode}): ${apk.stdout.slice(-500)}`);
    }

    logger.info("git clone");
    const clone = await runInSandbox(sandbox, {
      name: "git-clone",
      // GIT_TERMINAL_PROMPT=0 forces fail-fast on any auth prompt
      command:
        `sh -c 'mkdir -p /workspace && cd /workspace && ` +
        `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c core.askPass=/bin/true ` +
        `clone --depth 1 ${JSON.stringify(repoUrl)} repo 2>&1'`,
      timeoutMs: 120_000,
    });
    if (clone.exitCode !== 0) {
      throw new Error(`git clone failed: ${clone.stdout.slice(-500)}`);
    }

    const pkgRead = await runInSandbox(sandbox, {
      name: "read-pkg",
      command: "sh -c 'cat /workspace/repo/package.json'",
      timeoutMs: 10_000,
    });
    if (pkgRead.exitCode !== 0) {
      throw new Error(`No package.json in repo: ${pkgRead.stderr.slice(-200)}`);
    }
    const pkg = JSON.parse(pkgRead.stdout);
    const framework = detectFramework(pkg);
    if (!framework) {
      throw new Error("Could not detect framework (no next/vite/react-scripts/astro, no dev/start script)");
    }
    logger.info({ framework }, "Framework detected");

    logger.info("npm install");
    const install = await runInSandbox(sandbox, {
      name: "npm-install",
      command: "sh -c 'cd /workspace/repo && npm install --no-audit --no-fund --loglevel=error 2>&1'",
      timeoutMs: 600_000,
    });
    if (install.exitCode !== 0) {
      throw new Error(`npm install failed: ${install.stdout.slice(-500)}`);
    }

    logger.info({ cmd: framework.cmd, port: framework.port }, "Starting user app");
    await startBackground(sandbox, {
      name: "user-app",
      command: `sh -c 'cd /workspace/repo && ${framework.cmd}'`,
      waitForPorts: [framework.port],
      timeoutMs: 180_000,
    });

    logger.info("Starting Chromium");
    await startBackground(sandbox, {
      name: "chromium",
      command:
        "chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage " +
        `--remote-debugging-port=${CHROMIUM_CDP_PORT} --remote-debugging-address=0.0.0.0 ` +
        "--user-data-dir=/tmp/chrome-profile about:blank",
      waitForPorts: [CHROMIUM_CDP_PORT],
      timeoutMs: 60_000,
    });

    logger.info("Uploading and starting CDP reverse proxy (Host header rewriter)");
    await sandbox.fs.write("/tmp/cdp-proxy.js", CDP_PROXY_SOURCE);
    await startBackground(sandbox, {
      name: "cdp-proxy",
      command: "node /tmp/cdp-proxy.js",
      waitForPorts: [CDP_PROXY_PORT],
      timeoutMs: 20_000,
    });

    const appUrl = await createPublicPreview(sandbox, framework.port, "app-preview");
    const cdpUrl = await createPublicPreview(sandbox, CDP_PROXY_PORT, "cdp-preview");
    logger.info({ appUrl, cdpUrl }, "Preview URLs ready");

    return {
      sandboxName,
      appUrl,
      cdpUrl,
      framework: framework.name,
      appPortInSandbox: framework.port,
    };
  } catch (err) {
    logger.error({ err: err?.message }, "Provisioning failed; tearing down sandbox");
    await safeDeleteSandbox(sandboxName);
    throw err;
  }
}
