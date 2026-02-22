# Gemini Computer Use Integration Design

> Date: 2026-02-21
> Author: Yinfei Wang
> Status: Draft (v2 — thorough revision)

## Problem

When Gemini 3.1 Pro is used as the provider in Sentinel, the `browser_action` tool fails repeatedly because Gemini doesn't correctly format the required `action` parameter. This makes browser automation unusable with Gemini models.

Additionally, a critical bug in `gemini-format.ts` causes browser screenshots to never reach Gemini in the correct format, further degrading performance.

## Solution

Replace `browser_action` with Gemini's native **Computer Use** API for the GEMINI_3 variant. Computer Use is a first-class Gemini capability that handles browser interactions through a screenshot-action loop, eliminating tool parameter formatting issues.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  GeminiHandler.createMessage()                             │
│                                                            │
│  requestConfig.tools = [                                   │
│    { functionDeclarations: [read_file, execute_command, ...]}│
│    { computerUse: { environment: ENVIRONMENT_BROWSER } }   │
│  ]                                                         │
│  browser_action is EXCLUDED from functionDeclarations      │
└──────────────────────┬────────────────────────────────────┘
                       │
   Model response      │  part.functionCall
                       ▼
┌───────────────────────────────────────────────────────────┐
│  GeminiHandler (stream parsing)                            │
│                                                            │
│  Each functionCall → yields ApiStreamToolCallsChunk        │
│  Sets call_id = functionCall.id || auto-generated          │
│  (No CU-specific logic here — all functionCalls forwarded) │
└──────────────────────┬────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────────┐
│  StreamResponseHandler.getPartialToolUsesAsContent()       │
│                                                            │
│  pending.name is CU action?  (MCP-style normalization)     │
│    ├─ YES → ToolUse {                                      │
│    │          name: ClineDefaultTool.COMPUTER_USE,         │
│    │          params: { cu_action: "click_at", x, y }      │
│    │        }                                              │
│    └─ NO  → ToolUse { name: pending.name as ClineDefaultTool }│
└──────────────────────┬────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────────┐
│  ToolExecutor.execute(block)                               │
│                                                            │
│  block.name === COMPUTER_USE?                              │
│    ├─ YES → ComputerUseToolHandler.execute()               │
│    │          ├─ Auto-launch browser if needed             │
│    │          ├─ Dispatch to ComputerUseExecutor           │
│    │          ├─ Execute via BrowserSession (Puppeteer)    │
│    │          ├─ Capture screenshot                        │
│    │          └─ Return as ToolResponse with image         │
│    │                                                       │
│    └─ NO  → Standard handler (ReadFileToolHandler, etc.)   │
│                                                            │
│  Browser close logic:                                      │
│    if (name !== BROWSER && name !== COMPUTER_USE)           │
│      → closeBrowser()                                      │
└──────────────────────┬────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────────┐
│  ToolResultUtils.pushToolResult()                          │
│                                                            │
│  ToolResponse (string or [text, image]) → tool_result block│
│  tool_result { tool_use_id, content: [text, image] }       │
└──────────────────────┬────────────────────────────────────┘
                       │
   Next API request    │  User message with tool_result blocks
                       ▼
┌───────────────────────────────────────────────────────────┐
│  gemini-format.ts (convertAnthropicContentToGemini)        │
│                                                            │
│  tool_result → FunctionResponse:                           │
│    String content → { response: { result: "..." } }        │
│    Array content  → {                                      │
│      response: { result: "text..." },                      │
│      parts: [{ inlineData: { data, mimeType } }]           │
│    }                                                       │
└───────────────────────────────────────────────────────────┘
```

## Decision Records

### ADR-1: Single model with Computer Use (not dual model)

- **Context**: User wants Gemini for browser automation, but browser_action fails
- **Options**:
  1. Gemini 3.1 Pro for planning + Gemini 2.5 CU for browser (dual model)
  2. Gemini 3.1 Pro with built-in CU (single model)
- **Decision**: Single model — Gemini 3 Pro/Flash have built-in CU support
- **Consequences**: Simpler architecture, no per-tool model routing needed

### ADR-2: Replace browser_action entirely for GEMINI_3 variant

- **Context**: Should Computer Use coexist with browser_action or replace it?
- **Options**:
  1. Replace browser_action when GEMINI_3 is active
  2. Keep both and let user choose
- **Decision**: Replace. No browser_action for GEMINI_3.
- **Consequences**: Clean separation; non-Gemini models still use browser_action

### ADR-3: Keep Puppeteer as execution layer

- **Context**: Google's CU docs use Playwright, but Sentinel uses Puppeteer
- **Options**:
  1. Keep Puppeteer, add CU action mapping
  2. Switch to Playwright
- **Decision**: Keep Puppeteer. Reuse existing BrowserSession infrastructure.
- **Consequences**: Minimal refactoring; may miss some Playwright-specific CU features

### ADR-4: Model fallback for CU support

- **Context**: Not all Gemini models support Computer Use
- **Options**:
  1. Disable browser for unsupported models
  2. Fall back to latest CU-supported model for browser tasks
  3. Fall back to browser_action for unsupported models
- **Decision**: Fall back to the latest CU-supported model
- **Consequences**: Browser always works; user sees model switch notification

### ADR-5: MCP-style handler normalization (single COMPUTER_USE handler)

- **Context**: CU returns 13+ different function names (click_at, type_text_at, etc.) but the type system requires `ClineDefaultTool` enum values. How to route CU actions to a handler?
- **Options**:
  1. Register 13 handlers, one per CU action (requires changing `IFullyManagedTool.name` type to `string`)
  2. Add one `ClineDefaultTool.COMPUTER_USE` enum value and normalize in StreamResponseHandler (like MCP)
  3. Normalize only in ToolExecutorCoordinator.getHandler()
- **Decision**: Option 2 — MCP-style normalization in StreamResponseHandler
- **Rationale**: This matches the proven MCP tool pattern exactly. MCP tools also have dynamic names that aren't in the enum, and the codebase already normalizes them via `CLINE_MCP_TOOL_IDENTIFIER` detection. CU normalization follows the same pattern: detect CU action names, set `block.name = ClineDefaultTool.COMPUTER_USE`, put original action name in `params.cu_action`.
- **Consequences**:
  - Only 1 new enum value and 1 handler registration needed
  - No type system changes to IToolHandler interface
  - Normalization happens early (in StreamResponseHandler), so downstream code (ToolExecutor, coordinator) sees a standard ClineDefaultTool name
  - The original CU action name is preserved in `params.cu_action` for the handler to dispatch

## Detailed Design

### 1. Computer Use Action Set

Known CU actions returned by the model (from Gemini API docs):

```typescript
const COMPUTER_USE_ACTIONS = new Set([
  "click_at",
  "type_text_at",
  "scroll_document",
  "scroll_at",
  "hover_at",
  "key_combination",
  "drag_and_drop",
  "navigate",
  "go_back",
  "go_forward",
  "search",
  "open_web_browser",
  "wait_5_seconds",
])
```

### 2. Type System Integration

**Problem**: `IToolHandler.name` is typed as `ClineDefaultTool` enum. CU action names are dynamic strings not in this enum.

**Solution**: Add one new enum value:

```typescript
// In src/shared/tools.ts
export enum ClineDefaultTool {
  // ... existing 30 values ...
  COMPUTER_USE = "computer_use_action",  // NEW
}
```

Register ONE handler:
```typescript
this.coordinator.register(new ComputerUseToolHandler())
// Handler has: name = ClineDefaultTool.COMPUTER_USE
```

### 3. Stream Response Normalization (MCP Pattern)

**File**: `src/core/task/StreamResponseHandler.ts`

In `getPartialToolUsesAsContent()`, after the MCP check, add CU normalization:

```typescript
// Existing MCP check:
if (pending.name.includes(CLINE_MCP_TOOL_IDENTIFIER)) {
    // ... MCP normalization ...
}
// NEW CU check:
else if (isComputerUseAction(pending.name)) {
    results.push({
        type: "tool_use",
        name: ClineDefaultTool.COMPUTER_USE,
        params: {
            cu_action: pending.name,
            ...params,  // x, y, text, url, etc.
        },
        partial: true,
        isNativeToolCall: true,
        signature: pending.signature,
        call_id: pending.call_id,
    })
}
// Existing default:
else {
    // ... normal tool handling ...
}
```

**After normalization**, all downstream code sees `block.name = ClineDefaultTool.COMPUTER_USE` and accesses the original action via `block.params.cu_action`.

### 4. FunctionResponse Image Handling Fix (CRITICAL BUG)

**File**: `src/core/api/transform/gemini-format.ts` (lines 41-49)

**Current bug**: `tool_result` with image content is not converted to Gemini format.

**Root cause analysis**:
- `formatResponse.toolResult()` returns `[TextBlockParam, ImageBlockParam]` when images exist
- `ToolResultUtils.createToolResultBlock()` puts this array into `content` field
- `gemini-format.ts` places the array directly into `functionResponse.response.result`
- Images are JSON-stringified instead of converted to `inlineData`

**SDK types** (from `@google/genai` v1.30.0):
```typescript
class FunctionResponse {
    name?: string
    response?: Record<string, unknown>  // For text/JSON results
    parts?: FunctionResponsePart[]      // For media (images, files)
}

class FunctionResponsePart {
    inlineData?: FunctionResponseBlob   // base64 image
    fileData?: FunctionResponseFileData  // URI-based data
}

class FunctionResponseBlob {
    mimeType?: string  // "image/webp", "image/png"
    data?: string      // base64 encoded
}
```

**Fix**:
```typescript
case "tool_result": {
    if (typeof block.content === "string") {
        return {
            functionResponse: {
                name: block.tool_use_id,
                response: { result: block.content },
            },
        }
    }

    if (Array.isArray(block.content)) {
        // Separate text and image content
        const textParts: string[] = []
        const imageParts: Array<{ inlineData: { data: string; mimeType: string } }> = []

        for (const item of block.content) {
            if (item.type === "image" && item.source?.type === "base64") {
                imageParts.push({
                    inlineData: {
                        data: item.source.data,
                        mimeType: item.source.media_type,
                    },
                })
            } else if (item.type === "text") {
                textParts.push(item.text)
            } else {
                textParts.push(JSON.stringify(item))
            }
        }

        return {
            functionResponse: {
                name: block.tool_use_id,
                response: { result: textParts.join("\n") },
                ...(imageParts.length > 0 ? { parts: imageParts } : {}),
            },
        }
    }

    // Fallback for other content types
    return {
        functionResponse: {
            name: block.tool_use_id,
            response: { result: block.content },
        },
    }
}
```

### 5. Gemini call_id Fix (PREREQUISITE)

**File**: `src/core/api/providers/gemini.ts` (lines 216-233)

**Problem**: GeminiHandler doesn't set `tool_call.call_id` in the yielded chunk. Without it:
- `toolUseIdMap` is never populated for Gemini
- `ToolResultUtils` falls back to `toolUseId = "cline"`
- Tool results become plain `{ type: "text" }` blocks instead of `{ type: "tool_result" }`
- `gemini-format.ts` tool_result case is NEVER triggered for Gemini
- Screenshots are sent as standalone `inlineData` Parts, not inside `FunctionResponse`

**This is why the image bug was latent**: The buggy tool_result code was never reached because Gemini tool results bypass it entirely.

**For CU to work correctly**, screenshots MUST be inside `FunctionResponse` so Gemini can match them to specific CU actions. Each CU action needs its own screenshot response.

**Fix**: Add `call_id` to the yielded tool_calls chunk:

```typescript
if (part.functionCall) {
    const functionCall = part.functionCall
    const args = Object.entries(functionCall.args || {}).filter(([_key, val]) => !!val)
    if (functionCall.args && args.length > 0) {
        // Generate unique call_id per function call
        const callId = functionCall.id || `${chunk.responseId}_fc_${functionCallIndex++}`

        yield {
            type: "tool_calls",
            id: chunk.responseId,
            tool_call: {
                call_id: callId,  // NEW: enables proper FunctionResponse matching
                function: {
                    id: callId,   // Use same value so toolUseIdMap maps correctly
                    name: functionCall.name,
                    arguments: JSON.stringify(functionCall.args),
                },
            },
            signature: part.thoughtSignature,
        }
    }
}
```

**Impact**: After this fix, Gemini tool results will:
1. Be stored as `{ type: "tool_result", tool_use_id: callId, content: [...] }` blocks
2. Be converted to `FunctionResponse` format by gemini-format.ts
3. Include screenshots as `FunctionResponse.parts[].inlineData`

**Note**: `functionCallIndex` must be a counter scoped to the `createMessage()` call to ensure unique IDs across multiple function calls in the same response.

### 6. GeminiHandler Tool Config Changes

**File**: `src/core/api/providers/gemini.ts`

Add `computerUseEnabled` option and modify tools config:

```typescript
// In createMessage(), replace lines 170-179:
const isNativeToolCallsEnabled = tools?.length
const isComputerUseEnabled = this.options.computerUseEnabled
    && info.supportsComputerUse

if (isNativeToolCallsEnabled || isComputerUseEnabled) {
    const toolsArray: any[] = []

    if (isNativeToolCallsEnabled) {
        toolsArray.push({ functionDeclarations: tools })
    }
    if (isComputerUseEnabled) {
        toolsArray.push({
            computerUse: {
                environment: Environment.ENVIRONMENT_BROWSER,
            },
        })
    }

    requestConfig.tools = toolsArray

    if (isNativeToolCallsEnabled) {
        requestConfig.toolConfig = {
            functionCallingConfig: {
                mode: FunctionCallingConfigMode.ANY,
            },
        }
    }
}
```

**SDK Verification**: The `Tool` interface supports both `functionDeclarations` and `computerUse` as optional fields. They can be in separate Tool objects in the tools array. This is confirmed by the SDK types at `node_modules/@google/genai/dist/genai.d.ts` lines 7535-7558.

### 7. ComputerUseExecutor Design

**File**: `src/services/browser/ComputerUseExecutor.ts` (NEW)

Maps CU actions to Puppeteer commands:

```typescript
export class ComputerUseExecutor {
    constructor(
        private browserSession: BrowserSession,
        private viewportWidth: number,
        private viewportHeight: number,
    ) {}

    updateBrowserSession(session: BrowserSession): void {
        this.browserSession = session
    }

    async executeAction(
        actionName: string,
        args: Record<string, unknown>,
    ): Promise<BrowserActionResult> {
        switch (actionName) {
            case "click_at": {
                const px = denormalize(Number(args.x), this.viewportWidth)
                const py = denormalize(Number(args.y), this.viewportHeight)
                return this.browserSession.click(`${px},${py}`)
            }
            case "type_text_at": {
                const px = denormalize(Number(args.x), this.viewportWidth)
                const py = denormalize(Number(args.y), this.viewportHeight)
                await this.browserSession.click(`${px},${py}`)
                return this.browserSession.type(String(args.text))
            }
            case "scroll_document":
                return args.direction === "up"
                    ? this.browserSession.scrollUp()
                    : this.browserSession.scrollDown()
            case "navigate":
                return this.browserSession.navigateToUrl(String(args.url))
            case "go_back":
                return this.browserSession.doAction(
                    async (page) => page.goBack({ waitUntil: "domcontentloaded", timeout: 7000 })
                )
            case "go_forward":
                return this.browserSession.doAction(
                    async (page) => page.goForward({ waitUntil: "domcontentloaded", timeout: 7000 })
                )
            case "scroll_at": {
                const px = denormalize(Number(args.x), this.viewportWidth)
                const py = denormalize(Number(args.y), this.viewportHeight)
                const delta = Number(args.magnitude ?? 3) * 100
                const dir = String(args.direction)
                return this.browserSession.doAction(async (page) => {
                    await page.mouse.move(px, py)
                    if (dir === "up" || dir === "down") {
                        await page.mouse.wheel({ deltaY: dir === "down" ? delta : -delta })
                    } else {
                        await page.mouse.wheel({ deltaX: dir === "right" ? delta : -delta })
                    }
                })
            }
            case "hover_at": {
                const px = denormalize(Number(args.x), this.viewportWidth)
                const py = denormalize(Number(args.y), this.viewportHeight)
                return this.browserSession.doAction(
                    async (page) => page.mouse.move(px, py)
                )
            }
            case "key_combination": {
                const keys = args.keys as string[]
                return this.browserSession.doAction(async (page) => {
                    const modifiers = keys.slice(0, -1)
                    const finalKey = keys[keys.length - 1]
                    for (const mod of modifiers) await page.keyboard.down(mod)
                    await page.keyboard.press(finalKey)
                    for (const mod of modifiers.reverse()) await page.keyboard.up(mod)
                })
            }
            case "drag_and_drop": {
                const sx = denormalize(Number(args.startX), this.viewportWidth)
                const sy = denormalize(Number(args.startY), this.viewportHeight)
                const ex = denormalize(Number(args.endX), this.viewportWidth)
                const ey = denormalize(Number(args.endY), this.viewportHeight)
                return this.browserSession.doAction(async (page) => {
                    await page.mouse.move(sx, sy)
                    await page.mouse.down()
                    await page.mouse.move(ex, ey, { steps: 10 })
                    await page.mouse.up()
                })
            }
            case "open_web_browser":
                return this.browserSession.navigateToUrl("about:blank")
            case "search":
                return this.browserSession.navigateToUrl(
                    `https://www.google.com/search?q=${encodeURIComponent(String(args.query || ""))}`
                )
            case "wait_5_seconds": {
                await new Promise((r) => setTimeout(r, 5000))
                return this.browserSession.doAction(async () => {})
            }
            default:
                throw new Error(`Unknown Computer Use action: ${actionName}`)
        }
    }
}
```

### 8. ComputerUseToolHandler Design

**File**: `src/core/task/tools/handlers/ComputerUseToolHandler.ts` (NEW)

```typescript
export class ComputerUseToolHandler implements IFullyManagedTool {
    readonly name = ClineDefaultTool.COMPUTER_USE

    getDescription(block: ToolUse): string {
        const action = block.params.cu_action || "unknown"
        return `[Computer Use: ${action}]`
    }

    async handlePartialBlock(block: ToolUse, ui: StronglyTypedUIHelpers): Promise<void> {
        // Reuse existing browser_action UI type
        await ui.say(
            "browser_action",
            JSON.stringify({ action: block.params.cu_action, ...block.params }),
            undefined, undefined, block.partial,
        )
    }

    async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
        const actionName = block.params.cu_action as string
        const args = { ...block.params } as Record<string, unknown>
        delete args.cu_action  // Remove routing param

        const cuExecutor = config.services.computerUseExecutor
        if (!cuExecutor) {
            return formatResponse.toolError(
                "Computer Use is not available. The current model may not support it."
            )
        }

        // Auto-launch browser for navigate/open/search
        if (BROWSER_LAUNCH_ACTIONS.has(actionName)) {
            const browser = config.services.browserSession
            if (!browser.getConnectionInfo().isConnected) {
                // Approval flow (reuse existing browser launch approval)
                const url = String(args.url || "about:blank")
                if (!config.callbacks.shouldAutoApproveTool(ClineDefaultTool.BROWSER)) {
                    const approved = await ToolResultUtils.askApprovalAndPushFeedback(
                        "browser_action_launch", url, config,
                    )
                    if (!approved) return formatResponse.toolDenied()
                } else {
                    await config.callbacks.say("browser_action_launch", url)
                }
                config.services.browserSession = await config.callbacks.applyLatestBrowserSettings()
                cuExecutor.updateBrowserSession(config.services.browserSession)
                await config.services.browserSession.launchBrowser()
            }
        }

        config.taskState.consecutiveMistakeCount = 0

        // Execute CU action
        const result = await cuExecutor.executeAction(actionName, args)

        // Show result in UI
        await config.callbacks.say("browser_action_result", JSON.stringify(result))

        // Return with screenshot for the model
        return formatResponse.toolResult(
            `Computer Use action "${actionName}" executed.\nConsole: ${result.logs || "(none)"}`,
            result.screenshot ? [result.screenshot] : [],
        )
    }
}
```

### 9. ToolExecutor Changes

**File**: `src/core/task/ToolExecutor.ts`

**Registration** (in `registerToolHandlers()`):
```typescript
this.coordinator.register(new BrowserToolHandler())
this.coordinator.register(new ComputerUseToolHandler())  // ONE handler
```

**Browser close logic** (lines 393-396):
```typescript
// BEFORE:
if (block.name !== "browser_action") {
    await this.browserSession.closeBrowser()
}

// AFTER:
if (block.name !== ClineDefaultTool.BROWSER
    && block.name !== ClineDefaultTool.COMPUTER_USE) {
    await this.browserSession.closeBrowser()
}
```

Note: After StreamResponseHandler normalization, `block.name` is already `ClineDefaultTool.COMPUTER_USE`, not the raw CU action name. No need to check against the COMPUTER_USE_ACTIONS set.

### 10. GEMINI_3 Variant Changes

**File**: `src/core/prompts/system-prompt/variants/gemini-3/config.ts`

Remove `ClineDefaultTool.BROWSER` from the tools list (line 61).

The CU actions are automatically injected by the Gemini API when `computerUse` is in the tools config — they don't need to be listed as function declarations.

### 11. TaskServices Changes

**File**: `src/core/task/tools/types/TaskConfig.ts`

Add `computerUseExecutor` to `TaskServices`:

```typescript
export interface TaskServices {
    mcpHub: McpHub
    browserSession: BrowserSession
    urlContentFetcher: UrlContentFetcher
    diffViewProvider: DiffViewProvider
    fileContextTracker: FileContextTracker
    clineIgnoreController: ClineIgnoreController
    commandPermissionController: CommandPermissionController
    contextManager: ContextManager
    stateManager: StateManager
    computerUseExecutor?: ComputerUseExecutor  // NEW
}
```

Also add to `TASK_SERVICES_KEYS` in `src/core/task/tools/utils/ToolConstants.ts`:
```typescript
export const TASK_SERVICES_KEYS = [
    // ... existing keys ...
    "computerUseExecutor",
] as const
```

### 12. Services Initialization

Where `TaskConfig.services` is populated (find by searching for `browserSession:` assignments in task initialization code), add:

```typescript
const browserSettings = /* existing browser settings */
const viewportWidth = browserSettings?.viewport?.width || 900
const viewportHeight = browserSettings?.viewport?.height || 600

services.computerUseExecutor = new ComputerUseExecutor(
    services.browserSession,
    viewportWidth,
    viewportHeight,
)
```

### 13. Model Capability & Fallback

**File**: `src/shared/api.ts`

Add to `ModelInfo` interface:
```typescript
supportsComputerUse?: boolean
```

Set on supported models:
```typescript
// In geminiModels:
"gemini-3.1-pro-preview": { supportsComputerUse: true, ... }
"gemini-3-pro-preview":   { supportsComputerUse: true, ... }
"gemini-3-flash-preview": { supportsComputerUse: true, ... }
```

**Fallback logic** in GeminiHandler.createMessage():
```typescript
let effectiveModelId = modelId
if (this.options.computerUseEnabled && !info.supportsComputerUse) {
    effectiveModelId = "gemini-3-pro-preview"  // Latest CU-supported
    // Log model switch
}
```

### 14. Screenshot Feedback Loop

Each CU action gets its own screenshot. Multiple actions in one response are processed sequentially:

```
Model returns: [click_at(500, 300), type_text_at(500, 300, "hello")]

Execution (sequential via presentAssistantMessage):
  Block 0: click_at → execute → screenshot₁ → tool_result₁
  Block 1: type_text_at → execute → screenshot₂ → tool_result₂

Next API call sends:
  Content.parts = [
    FunctionResponse { name: id₁, response: {...}, parts: [screenshot₁] },
    FunctionResponse { name: id₂, response: {...}, parts: [screenshot₂] },
  ]
```

This works naturally with the existing sequential tool execution in `presentAssistantMessage()`.

### 15. Approval Flow

- **First CU action that triggers browser launch** (navigate, open_web_browser, search): Show approval dialog using existing `browser_action_launch` ask type
- **Subsequent CU actions**: No approval needed (browser already running)
- **Auto-approval**: Reuses `shouldAutoApproveTool(ClineDefaultTool.BROWSER)` setting
- **Plan mode**: CU actions allowed (same as browser_action)

### 16. UI Representation

Reuse existing message types (no new UI types needed):
- `browser_action_launch` → When navigate/open/search first launches browser
- `browser_action` → Show CU action details during streaming
- `browser_action_result` → Show screenshot after CU action execution

### 17. computerUseEnabled Flag Propagation

**How the flag reaches GeminiHandler**:

1. Add `computerUseEnabled` to `GeminiHandlerOptions` interface
2. In the provider factory (`src/core/api/index.ts`), set:
   ```typescript
   computerUseEnabled: !browserSettings?.disableToolUse
   ```
3. GeminiHandler checks: `this.options.computerUseEnabled && info.supportsComputerUse`

## Critical Bugs Found During Brainstorming

### Bug 1: gemini-format.ts FunctionResponse doesn't handle images

**Severity**: HIGH — affects ALL Gemini browser interactions
**File**: `src/core/api/transform/gemini-format.ts:41-49`
**Impact**: Screenshots are JSON-stringified instead of converted to inlineData
**Status**: Fixed in this design (Section 4)

### Bug 2: GeminiHandler missing call_id in tool_calls yield

**Severity**: HIGH — prevents FunctionResponse format for Gemini tool results
**File**: `src/core/api/providers/gemini.ts:216-233`
**Impact**: Tool results sent as plain text, not FunctionResponse. The gemini-format.ts tool_result conversion is never triggered for Gemini models.
**Status**: Fixed in this design (Section 5)

### Bug 3: Single-tab limitation

**Severity**: LOW — informational
**Impact**: BrowserSession only tracks one Page. CU actions opening new tabs would be invisible.
**Mitigation**: System prompt instructs model to avoid opening new tabs.

## Edge Cases & Error Handling

| Edge Case | Handling |
|-----------|----------|
| CU action when browser not launched | Auto-launch for navigate/open/search; error for others |
| CU action on non-CU-supported model | Model fallback to latest CU-supported model |
| CU action when computerUseExecutor is null | Return toolError message |
| Multiple CU actions in one response | Sequential execution with per-action screenshots |
| CU action fails (Puppeteer error) | Close browser, throw error (caught by task loop) |
| User rejects browser launch | Return toolDenied, model can retry with different approach |
| Non-CU model returns "click_at" function | StreamResponseHandler normalizes to COMPUTER_USE, handler returns error if executor is null |
| Model returns unknown CU action name | ComputerUseExecutor throws, handler catches and returns error |

## Complete File Change List

### Files to Modify

| File | Change | Section |
|------|--------|---------|
| `src/core/api/transform/gemini-format.ts` | **BUG FIX**: Handle image content in tool_result → FunctionResponse conversion | 4 |
| `src/core/api/providers/gemini.ts` | **BUG FIX**: Add call_id to tool_calls yield; Add computerUse tool config; Add model fallback | 5, 6, 13 |
| `src/core/task/StreamResponseHandler.ts` | Add CU action normalization in getPartialToolUsesAsContent() | 3 |
| `src/core/task/ToolExecutor.ts` | Register CU handler; Update browser close logic | 9 |
| `src/core/task/tools/types/TaskConfig.ts` | Add computerUseExecutor to TaskServices | 11 |
| `src/core/task/tools/utils/ToolConstants.ts` | Add computerUseExecutor to TASK_SERVICES_KEYS | 11 |
| `src/core/prompts/system-prompt/variants/gemini-3/config.ts` | Remove ClineDefaultTool.BROWSER from tools list | 10 |
| `src/shared/api.ts` | Add supportsComputerUse to ModelInfo; Set flag on Gemini 3.x models | 13 |
| `src/shared/tools.ts` | Add COMPUTER_USE to ClineDefaultTool enum | 2 |
| `src/core/api/index.ts` | Pass computerUseEnabled to GeminiHandler constructor | 17 |
| Task services initialization site | Create and wire ComputerUseExecutor instance | 12 |

### New Files to Create

| File | Purpose | Section |
|------|---------|---------|
| `src/shared/computer-use.ts` | CU action constants, isComputerUseAction(), denormalize() | — |
| `src/services/browser/ComputerUseExecutor.ts` | Maps CU actions → Puppeteer commands | 7 |
| `src/core/task/tools/handlers/ComputerUseToolHandler.ts` | CU tool handler: normalization target, approval, execution | 8 |

## Previously Open Questions (RESOLVED)

1. **Does gemini-3.1-pro-preview support Computer Use?**
   → Set `supportsComputerUse: true` optimistically. The model fallback logic (Section 13) handles the case where it doesn't. Verify with live testing.

2. **Can computerUse and functionDeclarations coexist in the same tools array?**
   → **YES**. Verified in SDK types (`node_modules/@google/genai/dist/genai.d.ts` lines 7535-7558). Both are optional fields in the `Tool` interface. They can be separate Tool objects in the tools array.

3. **Should each CU action get its own screenshot?**
   → **YES**. Each action is a separate ToolUse block processed sequentially. Each gets its own screenshot returned in its own FunctionResponse. This matches Google's CU documentation.
