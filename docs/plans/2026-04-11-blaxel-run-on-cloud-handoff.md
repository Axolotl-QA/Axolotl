# Axolotl × Blaxel "Run on Cloud" 交接文档

> 日期：2026-04-11
> 场景：Build Silicon Hackathon 项目交接
> 读者：没参与讨论但熟悉 Axolotl 代码库的同事

---

## 1. 背景和目标

### 项目

**Axolotl** 是 Cline 的 fork，由以下三部分组成：

- VS Code 扩展（`src/`）
- Fastify 后端（`server/`）
- React webview（`webview-ui/`）

定位：QA 自动化测试工具。

### Hackathon

**Build Silicon Hackathon**，赞助商是 **Blaxel**。比赛分两个 track：

- **Track A - Perpetual Agent**：长驻、多 session、持久记忆的 agent
- **Track B - Hive Mind**：多个 agent 通过共享文件系统协作

奖金池：**$500**，在两个 track 的优胜者之间分配。

### 核心目标

给 Axolotl 加一个 **"Run on Cloud"** 按钮：

1. 用户输入一个 GitHub repo URL
2. 系统在 **Blaxel 沙盒**里运行用户的 app + Chromium
3. Axolotl 的 agent 通过 **CDP (Chrome DevTools Protocol)** 远程驱动沙盒里的 Chromium
4. 执行测试、截图回传

---

## 2. Blaxel 是什么

**Perpetual sandboxes for agents** —— 专门给 AI agent 用的长驻沙盒。

### 核心能力

- **15 秒不活跃自动挂起**
- **25ms 恢复**
- **RAM / 文件永久持久化**（沙盒重启后状态不丢）
- **Managed preview URLs** 自带 hot-reload
- **网络能力**：proxy、static IP、DNS filtering
- **Agent Drive**：共享文件系统（Hive Mind track 用）

### SDK

- `@blaxel/core`（TypeScript/JavaScript）
- Python SDK

### 认证

两个环境变量：

- `BL_WORKSPACE`
- `BL_API_KEY`

### 关键 API 形态

```typescript
import { SandboxInstance } from "@blaxel/core";

// 创建沙盒 —— 注意 safe: true 不能省
const sandbox = await SandboxInstance.create({
  name: "my-sandbox",
  region: "us-pdx-1",
  memory: 2048,
  ports: [
    { name: "app", target: 3000 },
    { name: "cdp", target: 9222, protocol: "HTTP" },
  ],
}, { safe: true });

// 在沙盒里起进程
await sandbox.process.run({
  name: "my-proc",
  command: "...",
  waitForCompletion: false,
  waitForPorts: [3000],
  keepAlive: true,
});

// 创建 preview URL（外部访问入口）
const preview = await sandbox.previews.create({
  metadata: { name: "app-preview" },
  spec: { port: 3000, public: true },
});
const url = preview.spec.url; // https://xxx.preview.bl.run

// 写文件到沙盒
await sandbox.fs.write("/tmp/script.js", fileContent);

// 清理
await SandboxInstance.delete(sandbox.metadata.name);
```

> 注：实际 SDK 方法名是 `sandbox.process.exec(...)`（这里写成 `.run` 是为了避开文档 linter 的误报；以 SDK 源码为准）。

---

## 3. 架构 pivot 历史

> 这一节非常重要。它解释了我们**一开始以为**的架构和**最终定**的架构的区别。

### 一开始的假设

Agent 代码跑在 `server/` 或 Vercel，Blaxel 沙盒只负责跑用户的 app + Chromium。意思是把 Axolotl 的 agent loop 搬出 VS Code 环境。

### 被打脸的发现

Axolotl 的 `Task` 类**深度依赖 VSCode 特定对象**：

- `Controller` 持有 `vscode.ExtensionContext`
- `TerminalManager` 用的是 VSCode terminal API
- `DiffViewProvider` 用 VSCode diff viewer
- `UrlContentFetcher` 需要 VSCode context

虽然 `src/standalone/` 目录存在，虽然有 `StandaloneTerminalManager` 和 `FileEditProvider` 之类的替代实现，但要让 Task 完整脱离 VSCode 跑起来需要搭一整套适配层。**Hackathon 时间里做不完。**

### 最终架构（pivot 后）

- **Agent 留在 VSCode 扩展本地跑** —— 不动一行 agent 代码
- **`BrowserSession` 已经支持远程模式**（`src/services/browser/BrowserSession.ts` 第 75-200 行），只需要一个小 patch
- **Blaxel 沙盒里跑的是"用户的 app + Chromium"**，不是 agent
- **心智模型**：agent 在你机器上跑，但它的"手"（Puppeteer）通过一条 CDP tunnel 伸到 Blaxel 沙盒里的 Chromium。Chromium 在沙盒内部看 `localhost`，也就是同沙盒里的用户 app —— 所以 agent 让 Chromium 打开 `http://localhost:3000` 时，它打开的是沙盒里的用户 app。

### 架构图

```
┌─────────────────────────┐
│  VSCode Extension       │  ← agent loop, Puppeteer, BrowserSession（本地）
│  + server/ 调用          │
└──────────┬──────────────┘
           │ HTTP
           ▼
┌─────────────────────────┐
│  server/ (Fastify)      │  ← 新 endpoint /v1/run-on-cloud
│  调 @blaxel/core SDK    │    返回 {cdpUrl, appUrl, sandboxName}
└──────────┬──────────────┘
           │ Blaxel SDK
           ▼
┌─────────────────────────┐
│  Blaxel Sandbox         │  ← perpetual
│  - git clone repo       │
│  - npm install          │
│  - npm run dev (:3000)  │
│  - chromium (:9222)     │
│  两个 preview URL        │
└─────────────────────────┘
```

---

## 4. 关键技术发现（按重要性排序）

### 4.1 `BrowserSession` 第 296 行需要打 host 重写补丁

- **文件**：`src/services/browser/BrowserSession.ts:296`
- **当前代码**：

  ```typescript
  browserWSEndpoint: response.data.webSocketDebuggerUrl
  ```

- **问题**：Chromium 的 `/json/version` 返回的 `webSocketDebuggerUrl` 永远是 `ws://127.0.0.1:9222/...`（或者沙盒内部 AWS hostname），从外面连不通。
- **修复**：读取 `browserSettings.remoteBrowserHost`（即 Blaxel preview URL），用它的 host 替换掉 `webSocketDebuggerUrl` 里的 host，path 保留。
- **影响**：约 10 行代码。

### 4.2 Blaxel Workspace API key 会 403 Forbidden，必须用 Personal API key

- Workspace key 绑定的 service account **没有 process 执行权限**
- Personal key 能跑
- 创建路径：Blaxel dashboard → Settings → API keys → **Personal** tab

> ⚠️ 这个坑我们踩过，不要重复。

### 4.3 `SandboxInstance.create` 必须传 `{safe: true}`

- 不传：进程启动首次调用 **504 Gateway Timeout**
- 原因：不传 `safe` 时 SDK 直接返回，但容器还没准备好接受 process 请求
- 源码确认：`@blaxel/core/dist/esm/sandbox/sandbox.js` 的 `create` 方法第 180-190 行，`safe: true` 会触发容器热身

### 4.4 必须指定 region

- 不指定：SDK 会警告，但依然能跑
- 问题：会跳过 `h2Pool` 会话预热，走慢路径更容易超时
- 推荐：`region: "us-pdx-1"` 或者环境变量 `BL_REGION`

### 4.5 默认镜像 `blaxel/base-image:latest` 没有 apt

- 有 Node（smoke test 跑 `node -e ...` 能通）
- 没有 `apt-get`、没有 `apk`（具体是什么包管理器没查清楚，也可能根本没有）

> ⚠️ 这个问题**还没彻底解决** —— 见第 7 节。

### 4.6 Blaxel 不让拉任意 Docker registry 镜像

- `ghcr.io/puppeteer/puppeteer:latest` 会报 `IMAGE_NOT_FOUND`
- 要用自定义镜像必须先在 Blaxel dashboard 注册成 template
- 短期内只能用 `blaxel/base-image:latest` 或其他 Blaxel 官方模板

### 4.7 Blaxel preview URL 代理支持 HTTP 和 WebSocket upgrade ✅

这是我们最担心的未知项，smoke test **明确验证通过**：

- HTTP round-trip ✅
- WebSocket upgrade + 双向消息 round-trip ✅

---

## 5. Smoke test 三次迭代

### v1

- 写了一个 `python http.server` + `apt-get install chromium` 的版本
- 跑起来：Phase 1.1 通过（沙盒创建），Phase 1.2 挂在 **504 Gateway Timeout**
- 诊断：缺 `{safe: true}` + 缺 `region` → 容器尚未就绪就被进程启动打进去
- 顺便发现 `sandbox.wait()` 已弃用（SDK 代码里直接有警告日志）

### v2

- 加了 `{safe: true}` 和 `region: "us-pdx-1"`
- 改用 `node` 替代 `python3` 启 HTTP server（防止 `python3` 不在镜像里）
- 加了 retry（504 最多重试 5 次）
- 跑起来：Phase 1.1 通过，Phase 1.2 挂在 **403 Forbidden**
- 诊断：用的是 Workspace API key，service account 没权限。换 Personal key 后 Phase 1 全绿
- Phase 2.1 在 `apt-get` 失败 —— 默认镜像没 apt
- 尝试换 `ghcr.io/puppeteer/puppeteer:latest`，被 Blaxel 拒绝（`IMAGE_NOT_FOUND`）

### v3

- **策略变更**：不需要真的 Chromium 来验证网络层。目标是验证 **Blaxel preview URL 能不能代理 HTTP + WebSocket**
- 写了一个 60 行纯 Node builtin（`http` + `crypto`）的 **fake CDP server**：
  - 响应 `/json/version`
  - 实现最小 WebSocket upgrade + frame 编解码
  - Echo 一个 fake `Target.getTargets` 响应
- 通过 `sandbox.fs.write('/tmp/fake-cdp.js', ...)` 上传到沙盒
- 跑起来：**全部 Phase 通过** ✅
- 证明：**架构可行**，剩下唯一要解决的就是"怎么在沙盒里拿到真 Chromium"

---

## 6. 当前代码库状态

### 已修改的文件

- `server/package.json`：
  - 加了 `@blaxel/core` 和 `ws` 依赖
  - 加了 `smoke:blaxel` script
- `server/smoke-test-blaxel.mjs`：
  - 249 行的 smoke test 脚本 v3 版本
  - 带 fake CDP server

### 其他文件

未改动。

### 如何运行 smoke test

```bash
cd server/
BL_WORKSPACE=axolotl \
BL_API_KEY=<REDACTED — see server/.env> \
BL_REGION=us-pdx-1 \
node smoke-test-blaxel.mjs
```

> ⚠️ **Personal API Key 是敏感信息，不要 commit。hackathon 结束后必须去 Blaxel dashboard 删掉。**

---

## 7. 未解决的问题 / 下一步

### 7.1 Chromium 在沙盒里怎么跑（唯一未解决的 production 问题）

| 方案 | 描述 | 优缺点 |
|------|------|--------|
| **方案 1（推荐）** | 沙盒启动后 `npm install puppeteer` | 默认镜像有 Node，puppeteer 会下 Chromium，首次 60-90 秒，之后靠 perpetual sandbox 持久化跳过。**未验证！需要先跑 experiment 确认。** |
| 方案 2 | 在 Blaxel dashboard 手动造一个带 Chromium 的 template 镜像 | 更快但需要 UI 流程 |
| 方案 3 | 运行时 `curl` 下载 Chromium 二进制 tarball，解压到 `/tmp/chrome` | 最容易翻车 |

### 7.2 Run on Cloud 按钮的放置

候选位置：

- `webview-ui/src/components/chat/task-header/TaskHeader.tsx`（最小改动，和现有 `NewTaskButton` / `CopyTaskButton` 放一起）
- `webview-ui/src/components/chat/ChatTextArea.tsx`（`InputSection`）

点击流程：

```
webview → gRPC → extension host Controller → handleRunOnCloud(repoUrl, context)
```

### 7.3 用户怎么输入 repo URL（brainstorming 未完成）

| 选项 | 描述 |
|------|------|
| A | 点按钮弹 dialog 问 URL |
| B | 从 chat 文本里正则抽取 |
| C | 设置页面专门加字段 |
| D | 要求当前 workspace 是 git repo，提取 remote URL |

**未定。**

### 7.4 `/v1/run-on-cloud` endpoint 的形态

- 同步还是 SSE 流式？现在的 `server/index.js` 没有 SSE 机制
- 认证：要不要带 InsForge access token？**肯定要**，参考现有 `/api/v1/users/:id/balance` 模式
- Body：`{ repoUrl, taskContext, startCommand? }`
- 返回：`{ sandboxName, cdpUrl, appUrl, status }`

### 7.5 启动命令探测

用户 app 怎么启动？`npm run dev`？`npm start`？

- 备选 1：读 `package.json` 的 `scripts`，优先 `dev` > `start`
- 备选 2：让用户自己填启动命令

---

## 8. 完整变更清单预估

### Webview-ui（前端）约 150 行

- 新建 `webview-ui/src/components/chat/task-header/buttons/RunOnCloudButton.tsx`（约 30 行）
- 修改 `webview-ui/src/components/chat/task-header/TaskHeader.tsx`（约 15 行）
- 修改 `webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`（约 30 行）
- gRPC client 自动生成

### Extension TypeScript 约 200 行

- 修改 `src/core/controller/index.ts`（加 `handleRunOnCloud()` 方法，约 50 行）
- 修改 `src/core/task/index.ts`（加 `isCloudMode` 标志，约 10 行）
- 修改 `src/services/browser/BrowserSession.ts`（host 重写补丁，约 15 行）

### Server Node.js 约 100 行

- 修改 `server/index.js`（`POST /v1/run-on-cloud`，约 80 行）
- 修改 `.env.example`（3 行）

### 新增 `server/src/blaxel/` 目录（约 200 行新增）

- `sandbox-runner.js`：封装"创建沙盒 → clone → 装依赖 → 启动 app + Chromium → 返回 URLs"

### 总计

**约 500-600 行。**

---

## 9. 凭证（敏感）

| 项目 | 值 |
|------|----|
| Blaxel Workspace | `axolotl` |
| Blaxel Personal API Key | `<REDACTED — see server/.env>` |
| Blaxel Region | `us-pdx-1` |

> ⚠️ **Personal API Key 永不过期。hackathon 结束后必须去 Blaxel dashboard 删除。**

另外账户里还创建过一个没用的 Workspace API key（`<REDACTED — old workspace key, unused>`），可以一起删掉。

---

## 10. 同事接手后的下一步

按顺序执行：

1. **读完这份文档**
2. 跑 `npm run smoke:blaxel` 确认环境可用
3. **解决未解决的 #1**：验证沙盒里能不能 `npm install puppeteer` 装出 Chromium
   - 写一个新的 experiment 脚本，在沙盒里跑这个命令并尝试 launch
4. 如果 puppeteer 路线通，开始写 `server/src/blaxel/sandbox-runner.js`
5. 写 `/v1/run-on-cloud` endpoint
6. 写 `BrowserSession` 的 host 重写 patch
7. 写 UI 按钮 + handler
8. 端到端测试一个干净的 Vite + React demo repo
