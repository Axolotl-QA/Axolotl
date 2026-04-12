# Run on Cloud (Blaxel Sandbox) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add a "Run on Cloud" button to the Axolotl VS Code extension. User pastes a GitHub repo URL + optional testing focus; we provision a Blaxel sandbox running the repo + headless Chromium and start a normal Axolotl Task whose BrowserSession drives that remote Chromium via a Blaxel public preview URL.

**Architecture:** Agent loop runs **locally in the VS Code extension**, unmodified. Only the user's app + Chromium move to a Blaxel sandbox. The new gRPC handler constructs a task with `taskSettings.browserSettings.remoteBrowserEnabled=true` and `remoteBrowserHost=<cdpPreviewUrl>` — existing `BrowserSession.launchRemoteBrowser()` picks up these settings and connects over CDP. No stateManager global mutation.

**Tech Stack:**
- `@blaxel/core` v0.2.79 (Blaxel SDK, Node.js ESM)
- Blaxel default image: `blaxel/base-image:latest` (Alpine Linux 3.23, musl libc)
- Alpine native Chromium via `apk add --no-cache chromium`
- Fastify + dotenv in `server/`
- Existing Axolotl stack: proto-generated gRPC (`proto/cline/task.proto` → `src/shared/proto/cline/task.ts`), Puppeteer-core for CDP, per-RPC handler files under `src/core/controller/task/`

---

## Environmental Assumptions (Verified 2026-04-11)

All facts below were grepped/read from the current worktree. Do not skip this list — several Task steps depend on these exact paths.

| Assumption | Verified |
|---|---|
| Proto file: `proto/cline/task.proto`, `service TaskService` on line 12, `newTask` RPC on line 24 | ✅ grep output |
| Proto build: `node scripts/build-proto.mjs` (no npm alias; run direct) | ✅ script inspected |
| Proto TS output: `src/shared/proto/` (gitignored, generated) | ✅ `TS_OUT_DIR` in build-proto.mjs |
| Path alias: `@shared/*` → `src/shared/*` (tsconfig.json line 51) | ✅ tsconfig read |
| Controller RPC pattern: one file per RPC under `src/core/controller/task/` | ✅ 6 existing files like `newTask.ts`, `clearTask.ts` |
| `newTask.ts` handler signature: `async function newTask(controller: Controller, request: NewTaskRequest): Promise<String>` | ✅ read file |
| `Controller.initTask(text, images, files, historyItem, taskSettings)` — 5th arg is `taskSettings` which natively supports `browserSettings.{remoteBrowserEnabled, remoteBrowserHost}` | ✅ read from `newTask.ts` line 92-99 |
| `src/services/browser/BrowserSession.ts` remote branch: lines 292-311 (`versionUrl` → `axios.get` → `webSocketDebuggerUrl` → `connect`) | ✅ sed output |
| TaskHeader button group: `webview-ui/src/components/chat/task-header/TaskHeader.tsx:173` (`<NewTaskButton className={BUTTON_CLASS} onClick={onClose} />` inside `inline-flex` div at line 166) | ✅ sed output |
| Existing buttons: `CompactTaskButton`, `CopyTaskButton`, `DeleteTaskButton`, `NewTaskButton`, `OpenDiskConversationHistoryButton` in `task-header/buttons/` | ✅ ls |
| `server/index.js` has NO dotenv import — env must come from shell or be added | ✅ grep |
| Blaxel default image is Alpine 3.23 (musl). Has `apk`, does NOT have `apt-get` | ✅ smoke test output |

---

## Known SDK Constraints (Read First)

1. **`sandbox.process.exec({ waitForCompletion: true })` silently hangs on long commands.** Node's event loop goes idle and the process exits 0 mid-await with NO error. **Workaround**: use `waitForCompletion: false` then poll `sandbox.process.get(name)` on a `setInterval` loop (Task 2).
2. **`sandbox.process.wait()` has the same bug** — don't use it.
3. **`SandboxInstance.create` must be called with `{ safe: true }` second arg.** Without it, first `process.exec` gets 504 Gateway Timeout.
4. **`region` is practically required.** Without it, h2Pool session warmup is skipped and routing is flaky. Pass `region: process.env.BL_REGION || "us-pdx-1"`.
5. **Ports must be declared at sandbox creation time.** Cannot add ports to a running sandbox. We declare a superset (3000, 5173, 4321, 9222).
6. **Chromium returns `ws://<internal-ip>:9222/...` from `/json/version`.** Must rewrite the host to the preview URL origin before passing to Puppeteer (Task 6).
7. **Default image is Alpine.** Use `apk add --no-cache <pkg>`, not `apt-get`. Chromium package is just `chromium`. `git` is NOT preinstalled — `apk add --no-cache git` is required before `git clone`.
8. **Blaxel only allows images registered as templates** — you cannot point at `ghcr.io/puppeteer/puppeteer:latest` without pre-registering. Stick with `blaxel/base-image:latest`.
9. **Workspace API keys get 403 Forbidden on `process.exec`.** Must use a Personal API key.

---

## Task Overview

| # | Title | Files | Est. lines |
|---|---|---|---|
| 1 | Add dotenv + Blaxel env vars to server | `server/package.json`, `server/index.js`, `server/.env.example` | ~20 |
| 2 | Create `server/blaxel/sandboxClient.js` — SDK workaround helpers | new | ~80 |
| 3a | Create `detectFramework()` + write unit test FIRST (TDD) | new: `server/blaxel/detectFramework.js`, `server/blaxel/detectFramework.test.js` | ~40 |
| 3b | Create `sandboxRunner.js` skeleton + `provisionCloudRun()` stub | new: `server/blaxel/sandboxRunner.js` | ~50 |
| 3c | Fill in apk + clone + read package.json + detect framework | modify sandboxRunner.js | ~60 |
| 3d | Fill in npm install + start app + start chromium + previews + teardown | modify sandboxRunner.js | ~80 |
| 4 | Add `POST /v1/run-on-cloud` Fastify route + `buildCloudPrompt()` | modify `server/index.js` | ~60 |
| 5 | Manual server test with curl | none | 0 |
| 6 | Patch `BrowserSession.ts` line 296 to rewrite WS URL host | modify `src/services/browser/BrowserSession.ts` | ~15 |
| 7 | Add `runOnCloud` RPC to `proto/cline/task.proto` + regenerate | modify `proto/cline/task.proto` | ~20 |
| 8 | Create `src/core/controller/task/runOnCloud.ts` (per-RPC handler) | new | ~80 |
| 9 | Create `RunOnCloudButton.tsx` + mount in TaskHeader | new + modify `TaskHeader.tsx:166-175` | ~45 |
| 10a | Create `RunOnCloudDialog.tsx` shell with form fields | new | ~60 |
| 10b | Wire dialog submit to gRPC client | modify dialog | ~30 |
| 10c | Dialog error + loading states | modify dialog | ~25 |
| 11 | Verify extension dev host shows the button + dialog works | none | 0 |
| 12 | End-to-end demo with a known-good Vite repo | optional: `docs/demos/` | 0 |

**Total estimated new/modified code: ~665 lines**

---

## Task 0: Pre-flight check (mental, no code)

Before starting, confirm your local Node is one of:
- Node 20.x (`/opt/homebrew/Cellar/node@20/...`)
- Node 22.x (`/opt/homebrew/Cellar/node@22/...`)

**Avoid Node 24 via Homebrew on macOS** — the current brew Cellar has a broken `libsimdjson.26.dylib` symlink. If `node --version` fails with a dyld error, export `PATH=/opt/homebrew/Cellar/node@22/<version>/bin:$PATH` for this shell.

Also confirm smoke test passes before touching any code:

```bash
cd server
BL_WORKSPACE=axolotl BL_API_KEY=<personal-key> BL_REGION=us-pdx-1 \
  node smoke-test-blaxel.mjs
```

Expected: `ALL PHASES PASSED -- Main architecture is GO`.

---

## Task 1: Add dotenv + Blaxel env vars to server/

**Files:**
- Modify: `server/package.json` (add `dotenv` dep)
- Modify: `server/index.js` (line 1 — add `import "dotenv/config"`)
- Create: `server/.env.example`

**Step 1: Install dotenv in server/**

```bash
cd server && npm install dotenv
```

**Step 2: Create `.env.example`**

Write `server/.env.example`:

```bash
# Existing (InsForge / Axolotl auth)
INSFORGE_BASE_URL=https://4zxsfry3.us-west.insforge.app
INSFORGE_API_KEY=
INSFORGE_ANON_KEY=
APP_BASE_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
PORT=8080

# New: Blaxel for Run on Cloud. Use a PERSONAL API key — Workspace keys
# are 403 Forbidden on sandbox.process.exec.
BL_WORKSPACE=axolotl
BL_API_KEY=
BL_REGION=us-pdx-1
```

**Step 3: Load `.env` at the top of `server/index.js`**

Add as the VERY FIRST line of `server/index.js`:

```javascript
import "dotenv/config";
```

Then in the existing `const { ... } = process.env;` destructure (currently lines 5-12), add three lines:

```javascript
const {
  INSFORGE_BASE_URL,
  INSFORGE_API_KEY,
  INSFORGE_ANON_KEY,
  APP_BASE_URL,
  CORS_ORIGIN,
  PORT = "8080",
  BL_WORKSPACE,
  BL_API_KEY,
  BL_REGION = "us-pdx-1",
} = process.env;
```

Add this `runOnCloudEnabled` flag immediately after the fastify instance is declared (so we can call `fastify.log.warn`):

```javascript
const runOnCloudEnabled = Boolean(BL_WORKSPACE && BL_API_KEY);
if (!runOnCloudEnabled) {
  fastify.log.warn("Run on Cloud disabled: BL_WORKSPACE and BL_API_KEY not set");
}
```

**Step 4: Verify**

```bash
cd server && echo "BL_WORKSPACE=axolotl" > .env.test && node -e 'import("dotenv").then(d => { d.config({path:".env.test"}); console.log(process.env.BL_WORKSPACE); })' && rm .env.test
```

Expected: `axolotl`

**Step 5: Commit**

```bash
git add server/package.json server/package-lock.json server/index.js server/.env.example
git commit -m "feat(server): add dotenv and Blaxel env vars for Run on Cloud"
```

---

## Task 2: Create sandboxClient helpers (SDK workaround)

**Files:**
- Create: `server/blaxel/sandboxClient.js`

**Rationale:** All long-running commands go through `runInSandbox()` which wraps `waitForCompletion:false` + `setInterval` polling. **Do not use `waitForCompletion:true` or `sandbox.process.wait()` anywhere** — both have the silent-exit bug.

**Step 1: Create `server/blaxel/sandboxClient.js`**

```javascript
// server/blaxel/sandboxClient.js
// Thin helpers around @blaxel/core that work around known SDK bugs.
//
// Bug: sandbox.process.exec({waitForCompletion:true}) silently hangs on long
// commands — Node event loop drains and the process exits 0 with no error.
// Workaround: waitForCompletion:false + setInterval polling. The setInterval
// keeps the event loop alive so awaits actually resolve.

import { SandboxInstance } from "@blaxel/core";

/**
 * Start a process and block until it completes.
 * Returns { stdout, stderr, exitCode }.
 */
export async function runInSandbox(sandbox, { name, command, timeoutMs = 300_000 }) {
  await sandbox.process.exec({
    name,
    command,
    waitForCompletion: false,
  });

  const startedAt = Date.now();
  const proc = await new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const p = await sandbox.process.get(name);
        const status = p?.status;
        if (status === "completed" || status === "failed") {
          clearInterval(timer);
          resolve(p);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`runInSandbox(${name}) timed out after ${timeoutMs}ms`));
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, 1500);
  });

  const stdout = (await sandbox.process.logs(name, "stdout").catch(() => "")) || "";
  const stderr = (await sandbox.process.logs(name, "stderr").catch(() => "")) || "";
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: Number(proc?.exitCode ?? -1),
  };
}

/**
 * Start a long-lived background process (dev server, chromium, etc).
 * Returns as soon as waitForPorts resolves — do NOT use runInSandbox.
 */
export async function startBackground(sandbox, { name, command, waitForPorts, timeoutMs = 180_000 }) {
  await sandbox.process.exec({
    name,
    command,
    waitForCompletion: false,
    waitForPorts,
    keepAlive: true,
    timeout: timeoutMs,
  });
}

/**
 * Create a public preview URL for a port. Returns the URL string.
 */
export async function createPublicPreview(sandbox, port, name) {
  const preview = await sandbox.previews.create({
    metadata: { name },
    spec: { port, public: true },
  });
  const url = preview.spec?.url;
  if (!url) throw new Error(`Preview URL missing in response for port ${port}`);
  return url;
}

/**
 * Safely delete a sandbox. Never throws.
 */
export async function safeDeleteSandbox(sandboxName) {
  try {
    await SandboxInstance.delete(sandboxName);
    return true;
  } catch {
    return false;
  }
}
```

**Step 2: Commit**

```bash
git add server/blaxel/sandboxClient.js
git commit -m "feat(server): add Blaxel sandbox helpers with SDK workaround"
```

---

## Task 3a: TDD `detectFramework()`

**Files:**
- Create: `server/blaxel/detectFramework.js`
- Create: `server/blaxel/detectFramework.test.js`

**Step 1: Write failing test FIRST**

Create `server/blaxel/detectFramework.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFramework } from "./detectFramework.js";

test("picks next when present", () => {
  const pkg = { dependencies: { next: "^14" } };
  assert.equal(detectFramework(pkg)?.name, "next");
  assert.equal(detectFramework(pkg)?.port, 3000);
  assert.equal(detectFramework(pkg)?.cmd, "npm run dev");
});

test("picks vite", () => {
  const pkg = { devDependencies: { vite: "^5" } };
  assert.equal(detectFramework(pkg)?.name, "vite");
  assert.equal(detectFramework(pkg)?.port, 5173);
});

test("picks react-scripts (CRA)", () => {
  const pkg = { dependencies: { "react-scripts": "^5" } };
  assert.equal(detectFramework(pkg)?.cmd, "npm start");
});

test("picks next over vite when both declared", () => {
  const pkg = { dependencies: { next: "14", vite: "5" } };
  assert.equal(detectFramework(pkg)?.name, "next");
});

test("falls back to npm run dev when only dev script present", () => {
  const pkg = { scripts: { dev: "foo" } };
  assert.equal(detectFramework(pkg)?.name, "unknown");
  assert.equal(detectFramework(pkg)?.cmd, "npm run dev");
});

test("falls back to npm start when only start script present", () => {
  const pkg = { scripts: { start: "bar" } };
  assert.equal(detectFramework(pkg)?.cmd, "npm start");
});

test("returns null when nothing matches", () => {
  const pkg = { name: "x", scripts: { build: "foo" } };
  assert.equal(detectFramework(pkg), null);
});
```

**Step 2: Run the test — it must fail**

```bash
cd server && node --test blaxel/detectFramework.test.js
```

Expected: `Error: Cannot find module '.../detectFramework.js'`

**Step 3: Write minimal `detectFramework.js`**

Create `server/blaxel/detectFramework.js`:

```javascript
// server/blaxel/detectFramework.js
// Given a parsed package.json, return { name, cmd, port } for how to
// start the app, or null if we can't figure it out.

const HINTS = [
  { dep: "next",           cmd: "npm run dev",   port: 3000 },
  { dep: "vite",           cmd: "npm run dev",   port: 5173 },
  { dep: "react-scripts",  cmd: "npm start",     port: 3000 },
  { dep: "astro",          cmd: "npm run dev",   port: 4321 },
];

export function detectFramework(packageJson) {
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  for (const hint of HINTS) {
    if (hint.dep in deps) {
      return { name: hint.dep, cmd: hint.cmd, port: hint.port };
    }
  }
  if (packageJson.scripts?.dev) {
    return { name: "unknown", cmd: "npm run dev", port: 3000 };
  }
  if (packageJson.scripts?.start) {
    return { name: "unknown", cmd: "npm start", port: 3000 };
  }
  return null;
}
```

**Step 4: Run the test — it must pass**

```bash
cd server && node --test blaxel/detectFramework.test.js
```

Expected: `# pass 7`

**Step 5: Commit**

```bash
git add server/blaxel/detectFramework.js server/blaxel/detectFramework.test.js
git commit -m "feat(server): detectFramework with 7 unit tests"
```

---

## Task 3b: sandboxRunner skeleton

**Files:**
- Create: `server/blaxel/sandboxRunner.js`

**Step 1: Write the skeleton**

```javascript
// server/blaxel/sandboxRunner.js
import { SandboxInstance } from "@blaxel/core";
import {
  runInSandbox,
  startBackground,
  createPublicPreview,
  safeDeleteSandbox,
} from "./sandboxClient.js";
import { detectFramework } from "./detectFramework.js";

const CHROMIUM_CDP_PORT = 9222;
// Sandboxes auto-suspend after ~15s idle but the metadata stays around.
// Give them a hard TTL so forgotten runs don't accumulate forever.
const SANDBOX_TTL = "60m";

/**
 * Provision a Blaxel sandbox for Run on Cloud.
 * Returns { sandboxName, appUrl, cdpUrl, framework, appPortInSandbox }.
 * On failure, tears down the sandbox before throwing.
 * On success, the caller owns the sandbox — it will auto-suspend and
 * auto-delete when TTL expires.
 */
export async function provisionCloudRun({ repoUrl, logger }) {
  const sandboxName = `axolotl-${Date.now()}`;
  logger.info({ sandboxName, repoUrl }, "Provisioning Blaxel sandbox");

  const sandbox = await SandboxInstance.create(
    {
      name: sandboxName,
      region: process.env.BL_REGION || "us-pdx-1",
      memory: 4096,
      ttl: SANDBOX_TTL,
      ports: [
        { name: "app3000", target: 3000 },
        { name: "app5173", target: 5173 },
        { name: "app4321", target: 4321 },
        { name: "cdp",     target: CHROMIUM_CDP_PORT, protocol: "HTTP" },
      ],
    },
    { safe: true },
  );
  logger.info("Sandbox created");

  try {
    // Tasks 3c and 3d fill in the provisioning steps here.
    throw new Error("provisionCloudRun not yet implemented");
  } catch (err) {
    logger.error({ err: err?.message }, "Provisioning failed; tearing down sandbox");
    await safeDeleteSandbox(sandboxName);
    throw err;
  }
}
```

**Step 2: Verify it loads without crashing**

```bash
cd server && node -e "import('./blaxel/sandboxRunner.js').then(m => console.log('loads:', typeof m.provisionCloudRun))"
```

Expected: `loads: function`

**Step 3: Commit**

```bash
git add server/blaxel/sandboxRunner.js
git commit -m "feat(server): sandboxRunner skeleton"
```

---

## Task 3c: Chromium install + clone + framework detection

**Files:**
- Modify: `server/blaxel/sandboxRunner.js` (replace the `throw new Error(...)` placeholder in the try block)

**Step 1: Replace the placeholder**

Replace the single `throw new Error("provisionCloudRun not yet implemented");` line with this block:

```javascript
    // ── Install Chromium (Alpine-native musl build) ──
    logger.info("apk add chromium + git");
    const apk = await runInSandbox(sandbox, {
      name: "apk-install",
      command: "sh -c 'apk add --no-cache chromium git 2>&1'",
      timeoutMs: 300_000,
    });
    if (apk.exitCode !== 0) {
      throw new Error(`apk add failed (exit ${apk.exitCode}): ${apk.stdout.slice(-500)}`);
    }

    // ── Clone the repo ──
    logger.info("git clone");
    const clone = await runInSandbox(sandbox, {
      name: "git-clone",
      command:
        `sh -c 'mkdir -p /workspace && git clone --depth 1 ${JSON.stringify(repoUrl)} /workspace/repo 2>&1'`,
      timeoutMs: 120_000,
    });
    if (clone.exitCode !== 0) {
      throw new Error(`git clone failed: ${clone.stdout.slice(-500)}`);
    }

    // ── Read package.json and detect framework ──
    const pkgRead = await runInSandbox(sandbox, {
      name: "read-pkg",
      command: "sh -c 'cat /workspace/repo/package.json'",
      timeoutMs: 10_000,
    });
    if (pkgRead.exitCode !== 0) {
      throw new Error(`No package.json in repo root: ${pkgRead.stderr.slice(-200)}`);
    }
    let pkg;
    try {
      pkg = JSON.parse(pkgRead.stdout);
    } catch (e) {
      throw new Error(`Malformed package.json: ${e.message}`);
    }
    const framework = detectFramework(pkg);
    if (!framework) {
      throw new Error(
        "Could not detect framework: no known dep (next/vite/react-scripts/astro) and no dev/start script",
      );
    }
    logger.info({ framework }, "Framework detected");

    // Task 3d fills in: npm install + start app + chromium + previews
    throw new Error("Task 3d not yet implemented");
```

**Step 2: Sanity check — no runtime test yet, just make sure the file still parses**

```bash
cd server && node --check blaxel/sandboxRunner.js
```

Expected: no output (exit 0).

**Step 3: Commit**

```bash
git add server/blaxel/sandboxRunner.js
git commit -m "feat(server): sandboxRunner adds apk + git clone + detect framework"
```

---

## Task 3d: npm install + start app + chromium + preview URLs

**Files:**
- Modify: `server/blaxel/sandboxRunner.js` (replace `throw new Error("Task 3d not yet implemented");`)

**Step 1: Replace the placeholder**

```javascript
    // ── npm install ──
    logger.info("npm install");
    const install = await runInSandbox(sandbox, {
      name: "npm-install",
      command:
        "sh -c 'cd /workspace/repo && npm install --no-audit --no-fund --loglevel=error 2>&1'",
      timeoutMs: 600_000,
    });
    if (install.exitCode !== 0) {
      throw new Error(`npm install failed: ${install.stdout.slice(-500)}`);
    }

    // ── Start user's app (background, waitForPorts) ──
    logger.info({ cmd: framework.cmd, port: framework.port }, "Starting user app");
    await startBackground(sandbox, {
      name: "user-app",
      command: `sh -c 'cd /workspace/repo && ${framework.cmd}'`,
      waitForPorts: [framework.port],
      timeoutMs: 180_000,
    });

    // ── Start headless Chromium (background, waitForPorts) ──
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

    // ── Create public preview URLs ──
    const appUrl = await createPublicPreview(sandbox, framework.port, "app-preview");
    const cdpUrl = await createPublicPreview(sandbox, CHROMIUM_CDP_PORT, "cdp-preview");
    logger.info({ appUrl, cdpUrl }, "Preview URLs ready");

    return {
      sandboxName,
      appUrl,
      cdpUrl,
      framework: framework.name,
      appPortInSandbox: framework.port,
    };
```

**Step 2: Verify file parses**

```bash
cd server && node --check blaxel/sandboxRunner.js
```

**Step 3: Commit**

```bash
git add server/blaxel/sandboxRunner.js
git commit -m "feat(server): sandboxRunner completes npm install + app/chromium start + previews"
```

---

## Task 4: Add `POST /v1/run-on-cloud` Fastify route

**Files:**
- Modify: `server/index.js`
  - Add import of `provisionCloudRun`
  - Add new route handler + `buildCloudPrompt()` helper
  - Position: before `fastify.listen({...})` at the very bottom

**Step 1: Add import at top (after existing imports)**

```javascript
import { provisionCloudRun } from "./blaxel/sandboxRunner.js";
```

**Step 2: Add `buildCloudPrompt()` helper somewhere near existing helpers (e.g. after `insforgeGetProfile`)**

```javascript
function buildCloudPrompt({ repoUrl, testingFocus, appUrl, framework }) {
  const focus = testingFocus?.trim()
    ? `User's testing focus:\n${testingFocus.trim()}\n\n`
    : "";
  return (
    `You are testing a web application running at ${appUrl}.\n\n` +
    `Repository: ${repoUrl}\n` +
    `Detected framework: ${framework}\n\n` +
    focus +
    `The browser you control is already connected to this app via remote CDP.\n` +
    `Please:\n` +
    `1. Explore the app's main user flows\n` +
    `2. Generate a test plan${focus ? " focused on the user's area of interest" : ""}\n` +
    `3. Execute the tests and capture screenshots + console logs as evidence\n` +
    `4. Produce a QA report summarizing pass/fail with cited evidence`
  );
}
```

**Step 3: Add the route (place it after the existing `/api/v1/users/:id/payments` route, before `fastify.listen`)**

```javascript
// POST /v1/run-on-cloud
// Body: { repoUrl: string, testingFocus?: string }
// Returns: { sandboxName, appUrl, cdpUrl, appPortInSandbox, framework, initialPrompt }
// Auth: Bearer access token (InsForge)
fastify.post("/v1/run-on-cloud", async (request, reply) => {
  if (!runOnCloudEnabled) {
    return reply.code(503).send({ error: "Run on Cloud not configured on this server" });
  }
  const token = extractToken(request);
  if (!token) return reply.code(401).send({ error: "Missing access token" });

  const { user, error: authErr } = await insforgeGetUser(token);
  if (authErr || !user) return reply.code(401).send({ error: "Invalid access token" });

  const { repoUrl, testingFocus } = request.body || {};
  if (!repoUrl || typeof repoUrl !== "string" || !/^https?:\/\/.+/.test(repoUrl)) {
    return reply.code(400).send({ error: "repoUrl must be an http(s) URL" });
  }

  try {
    const result = await provisionCloudRun({ repoUrl, logger: request.log });
    const initialPrompt = buildCloudPrompt({
      repoUrl,
      testingFocus,
      appUrl: `http://localhost:${result.appPortInSandbox}`,
      framework: result.framework,
    });
    return reply.send({ ...result, initialPrompt });
  } catch (err) {
    request.log.error({ err: err?.message }, "Run on Cloud failed");
    return reply.code(500).send({ error: err?.message || "Unknown error" });
  }
});
```

**Step 4: Parse check**

```bash
cd server && node --check index.js
```

**Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(server): POST /v1/run-on-cloud endpoint"
```

---

## Task 5: Manual server end-to-end test

**Step 1: Start the server with all env vars**

```bash
cd server
INSFORGE_BASE_URL=https://4zxsfry3.us-west.insforge.app \
INSFORGE_API_KEY=<existing> \
INSFORGE_ANON_KEY=<existing> \
APP_BASE_URL=http://localhost:3000 \
BL_WORKSPACE=axolotl \
BL_API_KEY=<personal-key> \
BL_REGION=us-pdx-1 \
node index.js
```

Expected: fastify starts on :8080, no "Run on Cloud disabled" warning.

**Step 2: Get an access token** — either log in via the extension and copy it, or use InsForge dashboard to issue a dev token.

**Step 3: Curl the endpoint**

```bash
curl -v -X POST http://localhost:8080/v1/run-on-cloud \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/vitejs/create-vite","testingFocus":"Check the landing page renders"}'
```

Expected (after ~60-120 seconds): HTTP 200 with a JSON body like

```json
{
  "sandboxName": "axolotl-1775...",
  "appUrl": "https://xxx.preview.bl.run",
  "cdpUrl": "https://yyy.preview.bl.run",
  "framework": "vite",
  "appPortInSandbox": 5173,
  "initialPrompt": "You are testing..."
}
```

**Step 4: Verify the URLs from your dev machine**

```bash
curl -sI <appUrl>/           # → 200 OK
curl -s  <cdpUrl>/json/version | jq .Browser   # → "HeadlessChrome/..."
```

**Step 5: Do NOT commit** — test only. Keep the sandbox alive for the next time you curl, it'll auto-suspend within 15s.

---

## Task 6: Patch BrowserSession to rewrite WS URL host

**Files:**
- Modify: `src/services/browser/BrowserSession.ts`

**Rationale:** Current code at line 296 takes `response.data.webSocketDebuggerUrl` verbatim. Chromium returns `ws://<internal-ip>:9222/devtools/browser/<uuid>` — that host is unreachable from outside the sandbox. We need to replace the scheme + host with the caller's `remoteBrowserHost` origin while keeping the `/devtools/...` path.

**Step 1: Read the current lines** — verify exact shape

```bash
sed -n '290,312p' src/services/browser/BrowserSession.ts
```

Expected:

```typescript
        const versionUrl = `${remoteBrowserHost.replace(/\/$/, "")}/json/version`
        console.info(`Fetching WebSocket endpoint from ${versionUrl}`)

        const response = await axios.get(versionUrl)
        browserWSEndpoint = response.data.webSocketDebuggerUrl

        if (!browserWSEndpoint) {
          throw new Error("Could not find webSocketDebuggerUrl in the response")
        }

        console.info(`Found WebSocket browser endpoint: ${browserWSEndpoint}`)

        // Cache the successful endpoint
        this.cachedWebSocketEndpoint = browserWSEndpoint
        this.lastConnectionAttempt = Date.now()

        this.browser = await connect({
          browserWSEndpoint,
          defaultViewport: getViewport(),
        })
```

**Step 2: Modify line 296**

Change

```typescript
        browserWSEndpoint = response.data.webSocketDebuggerUrl
```

to

```typescript
        browserWSEndpoint = this.rewriteWsUrlHost(
          remoteBrowserHost,
          response.data.webSocketDebuggerUrl,
        )
```

**Step 3: Add the helper as a private method on `BrowserSession`**

Find any other `private` method in the class (e.g. `getViewport()` if it's private, or after `launchRemoteBrowser()`). Add this method:

```typescript
/**
 * Chromium's /json/version returns webSocketDebuggerUrl as ws://<local-ip>:9222/...
 * When we reach Chromium through a reverse-proxied URL (e.g. Blaxel preview URL),
 * that local IP is unreachable. Rewrite the scheme + host to the proxy origin
 * while preserving the path + query.
 */
private rewriteWsUrlHost(proxyHost: string, originalWsUrl: string): string {
  try {
    const proxy = new URL(
      proxyHost.startsWith("http") ? proxyHost : `https://${proxyHost}`,
    )
    const original = new URL(originalWsUrl)
    const wsScheme = proxy.protocol === "https:" ? "wss:" : "ws:"
    return `${wsScheme}//${proxy.host}${original.pathname}${original.search}`
  } catch {
    return originalWsUrl
  }
}
```

**Step 4: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep BrowserSession || echo "no BrowserSession errors"
```

Expected: `no BrowserSession errors`

**Step 5: Commit**

```bash
git add src/services/browser/BrowserSession.ts
git commit -m "fix(browser): rewrite proxied CDP WS URL host"
```

---

## Task 7: Add `runOnCloud` RPC to task.proto

**Files:**
- Modify: `proto/cline/task.proto`

**Step 1: Add message types**

Somewhere in `proto/cline/task.proto` after `service TaskService { ... }` closes (find the closing brace of the service, then the message definitions start). Add new messages:

```proto
message RunOnCloudRequest {
  string repo_url = 1;
  string testing_focus = 2;
}

message RunOnCloudResponse {
  string sandbox_name = 1;
  string app_url = 2;
  string cdp_url = 3;
  string initial_prompt = 4;
  string framework = 5;
  int32 app_port_in_sandbox = 6;
}
```

**Step 2: Add RPC to `service TaskService` block**

Inside `service TaskService { ... }` (around line 24 where `newTask` is), add:

```proto
  // Provisions a Blaxel sandbox running the user's repo + Chromium, then starts
  // a new task whose BrowserSession connects to the remote Chromium via CDP.
  rpc runOnCloud(RunOnCloudRequest) returns (RunOnCloudResponse);
```

**Step 3: Regenerate TypeScript stubs**

```bash
node scripts/build-proto.mjs
```

Expected: no errors. New files appear under `src/shared/proto/cline/task.ts`.

**Step 4: Verify new types exist**

```bash
grep -n "RunOnCloudRequest\|RunOnCloudResponse" src/shared/proto/cline/task.ts | head
```

Expected: several matches.

**Step 5: Commit**

```bash
git add proto/cline/task.proto src/shared/proto/
git commit -m "feat(proto): add TaskService.runOnCloud RPC"
```

---

## Task 8: Create `runOnCloud` controller handler

**Files:**
- Create: `src/core/controller/task/runOnCloud.ts`

**Rationale:** Follow the existing one-file-per-RPC pattern of `newTask.ts`, `clearTask.ts`, etc. **Key architectural win:** `Controller.initTask(..., taskSettings)` natively accepts `taskSettings.browserSettings.{remoteBrowserEnabled, remoteBrowserHost}` — we don't touch stateManager globals. Clean and reversible.

**Step 1: Create the handler file**

```typescript
// src/core/controller/task/runOnCloud.ts
import { RunOnCloudRequest, RunOnCloudResponse } from "@shared/proto/cline/task"
import { Controller } from ".."

/**
 * Provisions a Blaxel sandbox for the given GitHub repo and starts a new Task
 * whose BrowserSession is configured to drive the sandbox's remote Chromium.
 *
 * The agent loop runs locally in the extension; only the user's app + Chromium
 * live in Blaxel. The browserSettings override is scoped to this task's
 * settings — we do NOT mutate global stateManager settings.
 */
export async function runOnCloud(
  controller: Controller,
  request: RunOnCloudRequest,
): Promise<RunOnCloudResponse> {
  const accessToken = await controller.authService.getAccessToken()
  if (!accessToken) {
    throw new Error("Please sign in before using Run on Cloud.")
  }

  const serverBaseUrl = process.env.AXOLOTL_SERVER_URL ?? "http://localhost:8080"
  const response = await fetch(`${serverBaseUrl}/v1/run-on-cloud`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      repoUrl: request.repoUrl,
      testingFocus: request.testingFocus || undefined,
    }),
  })

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(`Run on Cloud failed: ${errBody.error || response.statusText}`)
  }

  const result = (await response.json()) as {
    sandboxName: string
    appUrl: string
    cdpUrl: string
    initialPrompt: string
    framework: string
    appPortInSandbox: number
  }

  // Kick off a new Task. Override browserSettings for this task only;
  // the stateManager global settings are untouched.
  const currentBrowserSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")
  await controller.initTask(
    result.initialPrompt,
    undefined, // images
    undefined, // files
    undefined, // historyItem
    {
      browserSettings: {
        ...currentBrowserSettings,
        remoteBrowserEnabled: true,
        remoteBrowserHost: result.cdpUrl,
      },
    },
  )

  return RunOnCloudResponse.create({
    sandboxName: result.sandboxName,
    appUrl: result.appUrl,
    cdpUrl: result.cdpUrl,
    initialPrompt: result.initialPrompt,
    framework: result.framework,
    appPortInSandbox: result.appPortInSandbox,
  })
}
```

**Step 2: Register the handler**

Axolotl's controller dispatches RPCs automatically based on file name. Verify by grepping for how `newTask` is registered:

```bash
grep -rn "import.*newTask\|\\.newTask" src/core/controller/ | head
```

If there's a central dispatch file (e.g. `src/core/controller/task/index.ts` that re-exports all handlers), add `runOnCloud` to its exports:

```typescript
export { runOnCloud } from "./runOnCloud"
```

If dispatch is per-method manual wiring, find where `newTask` is hooked up to the gRPC server and add `runOnCloud` next to it.

**Step 3: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep runOnCloud || echo "no runOnCloud type errors"
```

**Step 4: Commit**

```bash
git add src/core/controller/task/runOnCloud.ts src/core/controller/task/index.ts
git commit -m "feat(controller): runOnCloud RPC handler"
```

---

## Task 9: RunOnCloudButton in TaskHeader

**Files:**
- Create: `webview-ui/src/components/chat/task-header/buttons/RunOnCloudButton.tsx`
- Modify: `webview-ui/src/components/chat/task-header/TaskHeader.tsx` (line 173 area)

**Step 1: Inspect an existing button for the pattern**

```bash
cat webview-ui/src/components/chat/task-header/buttons/NewTaskButton.tsx
```

Mimic its structure (import path, props shape, codicon pattern).

**Step 2: Create `RunOnCloudButton.tsx`**

```tsx
// webview-ui/src/components/chat/task-header/buttons/RunOnCloudButton.tsx
import { useState } from "react"
import RunOnCloudDialog from "../RunOnCloudDialog"

interface Props {
  className?: string
}

export default function RunOnCloudButton({ className }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className={className}
        onClick={() => setOpen(true)}
        title="Run on Cloud (Blaxel sandbox)">
        <i className="codicon codicon-cloud-upload" />
      </button>
      {open && <RunOnCloudDialog onClose={() => setOpen(false)} />}
    </>
  )
}
```

(Adjust `<button>` styling + icon to match NewTaskButton's actual pattern.)

**Step 3: Mount in TaskHeader**

Open `webview-ui/src/components/chat/task-header/TaskHeader.tsx`. At line 9-11 add the import:

```tsx
import RunOnCloudButton from "./buttons/RunOnCloudButton"
```

At line 173 (the `<NewTaskButton ... />` line inside the `inline-flex` div), add right before `<NewTaskButton ... />`:

```tsx
<RunOnCloudButton className={BUTTON_CLASS} />
```

**Step 4: Parse check**

```bash
npx tsc --noEmit -p webview-ui/tsconfig.json 2>&1 | grep RunOnCloud || echo "no RunOnCloud errors"
```

Note: Task 10a will create `RunOnCloudDialog` — at this point this task may fail the type check because `RunOnCloudDialog` doesn't exist yet. That's fine; do Task 10a immediately next and commit them together.

**Step 5: Commit after Task 10a passes**

---

## Task 10a: Dialog shell + form fields

**Files:**
- Create: `webview-ui/src/components/chat/task-header/RunOnCloudDialog.tsx`

**Step 1: Create the shell**

```tsx
// webview-ui/src/components/chat/task-header/RunOnCloudDialog.tsx
import { useState } from "react"

interface Props {
  onClose: () => void
}

export default function RunOnCloudDialog({ onClose }: Props) {
  const [repoUrl, setRepoUrl] = useState("")
  const [testingFocus, setTestingFocus] = useState("")

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}>
      <div
        className="bg-editor-background text-foreground rounded-md shadow-lg w-[460px] max-w-[90vw] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-semibold">Run on Cloud</h3>
          <p className="text-xs text-description">
            Spin up a Blaxel sandbox, clone the repo, run the app, and let the agent test it.
          </p>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium">GitHub repo URL</span>
          <input
            type="url"
            className="w-full bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm"
            placeholder="https://github.com/user/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            autoFocus
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium">
            Testing focus <span className="text-description">(optional)</span>
          </span>
          <textarea
            rows={4}
            className="w-full bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm"
            placeholder="e.g. Test the signup flow and check validation errors"
            value={testingFocus}
            onChange={(e) => setTestingFocus(e.target.value)}
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button className="px-3 py-1 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="px-3 py-1 text-sm bg-button-background text-button-foreground rounded"
            disabled>
            Run on Cloud
          </button>
        </div>
      </div>
    </div>
  )
}
```

(Exact class names depend on whether webview-ui uses Tailwind or CSS modules — match the conventions of neighboring components like `TaskHeader.tsx`.)

**Step 2: Commit (along with Task 9)**

```bash
git add webview-ui/src/components/chat/task-header/
git commit -m "feat(webview): RunOnCloudButton + RunOnCloudDialog shell"
```

---

## Task 10b: Wire dialog submit to gRPC client

**Files:**
- Modify: `webview-ui/src/components/chat/task-header/RunOnCloudDialog.tsx`

**Step 1: Find the gRPC client import for TaskService**

```bash
grep -rn "TaskServiceClient" webview-ui/src/services/ webview-ui/src/components/chat/chat-view/hooks/ | head
```

Use whatever import path `useMessageHandlers.ts` uses for `TaskServiceClient.newTask`.

**Step 2: Add submit handler to the dialog**

Inside `RunOnCloudDialog`, after the `useState` lines:

```tsx
import { TaskServiceClient } from "<same path as useMessageHandlers>"
import { RunOnCloudRequest } from "@shared/proto/cline/task"

// ... inside the component:
const [busy, setBusy] = useState(false)

const isValidUrl = /^https?:\/\/.+/.test(repoUrl)

const onSubmit = async () => {
  setBusy(true)
  try {
    await TaskServiceClient.runOnCloud(
      RunOnCloudRequest.create({ repoUrl, testingFocus }),
    )
    onClose()
  } catch (e: any) {
    console.error("Run on Cloud failed:", e)
    setBusy(false)
    // Task 10c adds UI for this error
  }
}
```

Replace the disabled `<button>Run on Cloud</button>` with:

```tsx
<button
  className="px-3 py-1 text-sm bg-button-background text-button-foreground rounded disabled:opacity-50"
  disabled={!isValidUrl || busy}
  onClick={onSubmit}>
  {busy ? "Provisioning..." : "Run on Cloud"}
</button>
```

**Step 3: Commit**

```bash
git add webview-ui/src/components/chat/task-header/RunOnCloudDialog.tsx
git commit -m "feat(webview): wire RunOnCloudDialog submit to TaskServiceClient.runOnCloud"
```

---

## Task 10c: Error and loading UI

**Files:**
- Modify: `webview-ui/src/components/chat/task-header/RunOnCloudDialog.tsx`

**Step 1: Add error state**

```tsx
const [error, setError] = useState<string | null>(null)
```

**Step 2: Update `onSubmit` to set it**

```tsx
const onSubmit = async () => {
  setBusy(true)
  setError(null)
  try {
    await TaskServiceClient.runOnCloud(
      RunOnCloudRequest.create({ repoUrl, testingFocus }),
    )
    onClose()
  } catch (e: any) {
    setError(e?.message || "Failed to start cloud run")
    setBusy(false)
  }
}
```

**Step 3: Render the error above the buttons (before `<div className="flex justify-end gap-2...">`)**

```tsx
{error && (
  <div className="text-xs text-error-foreground bg-error-background/20 border border-error-foreground/30 rounded px-2 py-1">
    {error}
  </div>
)}
```

**Step 4: Disable inputs while busy**

On the `<input>` and `<textarea>`, add `disabled={busy}`.

**Step 5: Commit**

```bash
git add webview-ui/src/components/chat/task-header/RunOnCloudDialog.tsx
git commit -m "feat(webview): RunOnCloudDialog error + loading states"
```

---

## Task 11: Verify extension dev host

**Step 1: Build webview-ui + start extension dev host**

```bash
npm run dev
```

(Exact command depends on Axolotl's build scripts — check `package.json`.)

**Step 2: Launch a dev VSCode window (F5 in VSCode or via the launch script)**

**Step 3: Open the Axolotl webview, start a task (any prompt)**

**Step 4: Verify the new cloud icon button appears in the TaskHeader** next to the "New Task" button.

**Step 5: Click it** — dialog should appear with both input fields.

**Step 6: Type a bad URL** like `hello` — the Run on Cloud button should stay disabled.

**Step 7: Type `https://github.com/vitejs/create-vite`** — button should enable.

**Step 8: DO NOT submit yet** (Task 12 is the full demo). Cancel the dialog.

**Step 9: No commit** — this is verification.

---

## Task 12: End-to-end demo

**Step 1: Make sure the server is running** (Task 5 setup).

**Step 2: In the extension, click Run on Cloud**, paste `https://github.com/vitejs/create-vite`, write `"Check that the Vite logo is visible and clickable"`, click Run on Cloud.

**Step 3: Wait ~90 seconds.** The dialog shows "Provisioning..." while the server does apk install + git clone + npm install + boot app + boot chromium.

**Step 4: Expect the dialog to close and a new Task to appear** in the chat with the synthesized initial prompt.

**Step 5: Verify the agent loop starts using remote Chromium** — first browser_action call should succeed with a screenshot (if host rewriting worked).

**Step 6: Let the agent complete the test plan** and produce a QA report with screenshots.

**Step 7: Open `appUrl`** (printed in server logs) in a real browser — you should see the actual Vite starter page.

**Step 8: If it all works, record a short video + write a demo log** to `docs/demos/2026-04-11-run-on-cloud-demo.md` and commit.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `apk add chromium` fails due to Blaxel egress policy | Low | If it does, pivot to a Blaxel-registered template. Not a plan-breaker. |
| Alpine Chromium crashes on launch (missing shared memory, etc) | Low | `--disable-dev-shm-usage` already in the command; if it still fails, add `--single-process` |
| `apk add git` fails | Low | Baked into the same `apk add` command in Task 3c |
| User's repo uses yarn/pnpm not npm | Medium | First version only supports npm. Detect lockfile and fail fast with useful error in Task 3d. v2 adds yarn/pnpm branches. |
| User's app requires env vars to boot | Medium | v1 doesn't pass env. `startBackground` will time out waiting for the port; surface it as a clear error. |
| User's app uses a port not in [3000, 5173, 4321] | Medium | Fail with "unsupported port" message. v2 can read vite.config/next.config and add dynamic ports. |
| SDK `waitForCompletion: true` bug resurfaces | Low | All long-running commands MUST go through `runInSandbox()`. Grep for `waitForCompletion: true` before committing to catch slip-ups. |
| `npm install` takes > 10 min and hits 600s timeout | Medium | For the demo pick a repo with small dependency tree (create-vite is ~30s) |
| Public CDP preview URL is a security hole | Accepted | Hackathon only. Document as known limitation. v2 uses `public: false` + `bl_preview_token`. |
| TTL of 60m cuts off a long demo | Low | `SANDBOX_TTL` is a constant in `sandboxRunner.js`; bump if needed. |
| `controller.authService.getAccessToken` method name differs from what I wrote | Medium | Task 8 Step 2 verifies the actual name via grep. If different, rename. |

---

## Demo Script

1. VSCode with Axolotl extension open, empty chat
2. Click the new **cloud-upload** icon in the task header toolbar
3. Dialog appears. Paste `https://github.com/vitejs/create-vite` + type "Check the Vite logo is visible and clickable"
4. Click **Run on Cloud**. Dialog shows "Provisioning..."
5. Talk through it while waiting (~90s): *"We just spun up a Blaxel perpetual sandbox in us-pdx-1. apk add chromium + git clone + npm install + boot the Vite app + boot headless Chromium, all in parallel. This is all happening in Blaxel, not on my laptop."*
6. Dialog closes, new Task appears with synthesized prompt
7. *"My Axolotl agent is still running locally in the extension — but watch: its first browser action is a screenshot, and that's Chromium inside the Blaxel sandbox, reached through a public preview URL with a CDP tunnel."*
8. Let the agent generate a test plan, execute it, take screenshots, produce a QA report
9. Open the `appUrl` in a real browser tab — "And here's the actual Vite app running in the same sandbox"
10. Close the laptop for 30s, reopen — "Sandbox auto-suspended after 15s of inactivity. When I access it again, it resumes in ~25ms with state intact. Track A: Perpetual Agent ✅"

---

## Out of Scope (v2+)

- yarn/pnpm/bun support
- Non-Node frameworks (Python, Go, Rails)
- User-provided env vars to the app
- Private repo clone (needs token/ssh key)
- Private CDP preview URL + token
- Multi-agent hive mind inside the sandbox (Track B)
- Cleanup/garbage collection for orphaned sandboxes (TTL of 60m is the MVP answer)
- Per-user sandbox quotas / billing
- SSE streaming progress from server to webview (currently synchronous POST)
- Auto-port-detection for Vite with non-default port
- Auto-env from `.env.example` in the user's repo

---

## Notes for Future You

- If Alpine Chromium has rendering bugs for a specific app, the fallback is to build a custom Blaxel template image. Blaxel Dashboard → Images → register a template based on `blaxel/base-image` with Chromium preinstalled. Then pass `image: "<your-template>"` to `SandboxInstance.create`.
- `runInSandbox()` is safe to use for anything EXCEPT long-lived daemons — use `startBackground()` for those.
- The SDK bug we worked around is in `@blaxel/core@0.2.79`. Before upgrading, test `waitForCompletion:true` with a >20s command. If fixed, collapse `runInSandbox()` to use the native `waitForCompletion:true` path.
- `sandbox.fs.write(path, contents)` is handy if you need to upload files (e.g., a custom npm config, a seed file). Smoke test v3 uses it to upload a fake CDP server.
- Preview URLs look like `https://<random-hex>.preview.bl.run`. They're globally routable and don't need DNS setup.
- `Controller.initTask()` 5th arg (`taskSettings`) is the RIGHT place to inject per-task browser config. Don't mutate `stateManager.getGlobalSettingsKey("browserSettings")` — it affects every future task.
