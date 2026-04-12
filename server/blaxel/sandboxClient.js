// Blaxel SDK helpers with workaround for the waitForCompletion:true bug.
// See docs/plans/2026-04-11-blaxel-run-on-cloud-plan.md for context.
import { SandboxInstance } from "@blaxel/core";

/**
 * Start a process and block until completion using setInterval polling.
 * Never use sandbox.process.exec({waitForCompletion:true}) or process.wait()
 * directly — both silently hang on long commands in @blaxel/core v0.2.79.
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
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: Number(proc?.exitCode ?? -1) };
}

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

export async function createPublicPreview(sandbox, port, name) {
  const preview = await sandbox.previews.create({
    metadata: { name },
    spec: { port, public: true },
  });
  const url = preview.spec?.url;
  if (!url) throw new Error(`Preview URL missing in response for port ${port}`);
  return url;
}

export async function safeDeleteSandbox(sandboxName) {
  try {
    await SandboxInstance.delete(sandboxName);
    return true;
  } catch {
    return false;
  }
}
