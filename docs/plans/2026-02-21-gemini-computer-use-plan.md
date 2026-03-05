# Gemini Computer Use Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `browser_action` with Gemini's native Computer Use API for the GEMINI_3 variant, enabling reliable browser automation with Gemini models.

**Architecture:** When a GEMINI_3 model is active, Sentinel adds a `computerUse` tool alongside regular `functionDeclarations`. The model returns CU actions (`click_at`, `type_text_at`, etc.) as standard function calls. StreamResponseHandler normalizes these to `ClineDefaultTool.COMPUTER_USE` (following the MCP pattern), and a single `ComputerUseToolHandler` dispatches to `ComputerUseExecutor` which maps actions to Puppeteer commands. Screenshots are returned as `FunctionResponse.parts[].inlineData`.

**Tech Stack:** TypeScript, `@google/genai` SDK (v1.30.0, `ComputerUse` type exists since v1.21.0), Puppeteer Core

**Design document:** `docs/plans/2026-02-21-gemini-computer-use-design.md`

---

## Task 1: Fix Critical Bug — GeminiHandler Missing call_id

Without `call_id`, Gemini tool results are sent as plain text instead of `FunctionResponse` format. This is a prerequisite for CU screenshots to work.

**Files:**
- Modify: `src/core/api/providers/gemini.ts:216-233`
- Test: `src/core/api/providers/__tests__/gemini-callid.test.ts` (or add to existing test file)

**Step 1: Write the failing test**

```typescript
// Test that GeminiHandler yields call_id in tool_calls chunks
import { GeminiHandler } from "../gemini"

describe("GeminiHandler call_id", () => {
    it("should include call_id in yielded tool_calls chunks", async () => {
        // Mock a Gemini response with functionCall
        const handler = new GeminiHandler({ /* mock options */ })
        // This test verifies the yield shape includes call_id
        // Exact setup depends on existing test infrastructure
        // Key assertion:
        // expect(chunk.tool_call.call_id).toBeDefined()
        // expect(chunk.tool_call.call_id).not.toBe(undefined)
    })
})
```

**Note:** If testing the stream is complex, this can be validated as part of the smoke test. The key verification is: after the fix, tool results should appear as `{ type: "tool_result" }` blocks instead of `{ type: "text" }` blocks.

**Step 2: Read the current code**

Read `src/core/api/providers/gemini.ts` lines 200-240 to understand the current function call handling.

**Step 3: Implement the fix**

In `src/core/api/providers/gemini.ts`, find the function call yield (around line 216). Add a `functionCallIndex` counter at the start of `createMessage()`, then modify:

```typescript
// Add at the start of createMessage():
let functionCallIndex = 0

// In the stream processing loop, replace the functionCall handling:
if (part.functionCall) {
    const functionCall = part.functionCall
    const args = Object.entries(functionCall.args || {}).filter(([_key, val]) => !!val)
    if (functionCall.args && args.length > 0) {
        const callId = functionCall.id || `${chunk.responseId}_fc_${functionCallIndex++}`
        yield {
            type: "tool_calls",
            id: chunk.responseId,
            tool_call: {
                call_id: callId,  // NEW
                function: {
                    id: callId,   // Match call_id for toolUseIdMap
                    name: functionCall.name,
                    arguments: JSON.stringify(functionCall.args),
                },
            },
            signature: part.thoughtSignature,
        }
    }
}
```

**Step 4: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to the change

**Step 5: Commit**

```bash
git add src/core/api/providers/gemini.ts
git commit -m "fix: add call_id to GeminiHandler tool_calls yield

Without call_id, Gemini tool results were sent as plain text blocks
instead of proper FunctionResponse format. This prevented screenshots
from reaching Gemini models in the correct format."
```

---

## Task 2: Fix Critical Bug — gemini-format.ts Image Handling

Fix image content conversion in tool_result → FunctionResponse. After Task 1, tool results WILL reach this code path.

**Files:**
- Modify: `src/core/api/transform/gemini-format.ts:41-49`
- Test: `src/core/api/transform/__tests__/gemini-format.test.ts` (create or add to existing)

**Step 1: Write the failing test**

Create test file (or add to existing):

```typescript
import { convertAnthropicContentToGemini } from "../gemini-format"

describe("convertAnthropicContentToGemini - tool_result", () => {
    it("converts tool_result with string content", () => {
        const content = [{
            type: "tool_result" as const,
            tool_use_id: "test-123",
            content: "success",
        }]
        const result = convertAnthropicContentToGemini(content)
        expect(result).toEqual([{
            functionResponse: {
                name: "test-123",
                response: { result: "success" },
            },
        }])
    })

    it("converts tool_result with image content to FunctionResponse with parts", () => {
        const content = [{
            type: "tool_result" as const,
            tool_use_id: "cu-action-456",
            content: [
                { type: "text" as const, text: "Action executed" },
                {
                    type: "image" as const,
                    source: {
                        type: "base64" as const,
                        media_type: "image/webp" as const,
                        data: "UklGRgAAAA==",
                    },
                },
            ],
        }]
        const result = convertAnthropicContentToGemini(content)
        expect(result).toHaveLength(1)

        const fr = result[0].functionResponse
        expect(fr.name).toBe("cu-action-456")
        expect(fr.response).toEqual({ result: "Action executed" })
        expect(fr.parts).toEqual([{
            inlineData: { data: "UklGRgAAAA==", mimeType: "image/webp" },
        }])
    })

    it("converts tool_result with text-only array content", () => {
        const content = [{
            type: "tool_result" as const,
            tool_use_id: "tool-789",
            content: [
                { type: "text" as const, text: "line 1" },
                { type: "text" as const, text: "line 2" },
            ],
        }]
        const result = convertAnthropicContentToGemini(content)
        const fr = result[0].functionResponse
        expect(fr.response).toEqual({ result: "line 1\nline 2" })
        expect(fr.parts).toBeUndefined()
    })
})
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/core/api/transform/__tests__/gemini-format.test.ts` (or the project's test runner)
Expected: FAIL — image test fails because current code doesn't separate images

**Step 3: Implement the fix**

In `src/core/api/transform/gemini-format.ts`, replace the `tool_result` case (lines 41-49):

```typescript
case "tool_result": {
    // Handle string content (simple case)
    if (typeof block.content === "string") {
        return {
            functionResponse: {
                name: block.tool_use_id,
                response: { result: block.content },
            },
        }
    }

    // Handle array content (may contain images)
    if (Array.isArray(block.content)) {
        const textParts: string[] = []
        const imageParts: Array<{ inlineData: { data: string; mimeType: string } }> = []

        for (const item of block.content as any[]) {
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

    // Fallback
    return {
        functionResponse: {
            name: block.tool_use_id,
            response: { result: block.content },
        },
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest src/core/api/transform/__tests__/gemini-format.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/api/transform/gemini-format.ts src/core/api/transform/__tests__/gemini-format.test.ts
git commit -m "fix: handle image content in Gemini FunctionResponse conversion

Screenshots from browser actions were being JSON-stringified instead of
converted to Gemini's inlineData format within FunctionResponse.parts.
This caused Gemini models to not properly receive browser screenshots."
```

---

## Task 3: Add ClineDefaultTool.COMPUTER_USE and CU Constants

**Files:**
- Modify: `src/shared/tools.ts`
- Create: `src/shared/computer-use.ts`

**Step 1: Add COMPUTER_USE to the enum**

In `src/shared/tools.ts`, add after the last enum value (e.g., after `AXOLOTL_WEB_SEARCH`):

```typescript
export enum ClineDefaultTool {
    // ... existing 30+ values ...
    AXOLOTL_WEB_SEARCH = "axolotl_web_search",
    COMPUTER_USE = "computer_use_action",  // NEW: Gemini Computer Use
}
```

**Step 2: Create the CU constants file**

Create `src/shared/computer-use.ts`:

```typescript
/**
 * Gemini Computer Use action names.
 * These are the function names returned by the model when Computer Use is enabled.
 * See: https://ai.google.dev/gemini-api/docs/computer-use
 */
export const COMPUTER_USE_ACTIONS = new Set([
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

/**
 * CU actions that should auto-launch the browser if not running.
 */
export const BROWSER_LAUNCH_ACTIONS = new Set([
    "navigate",
    "open_web_browser",
    "search",
])

/**
 * Check if a function name is a Computer Use action.
 */
export function isComputerUseAction(name: string): boolean {
    return COMPUTER_USE_ACTIONS.has(name)
}

/**
 * Convert CU normalized coordinate (0-999 grid) to pixel coordinate.
 */
export function denormalizeCoordinate(
    normalized: number,
    dimension: number,
): number {
    return Math.round((normalized / 1000) * dimension)
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/shared/tools.ts src/shared/computer-use.ts
git commit -m "feat: add ClineDefaultTool.COMPUTER_USE enum value and CU constants"
```

---

## Task 4: Add supportsComputerUse Flag to Model Info

**Files:**
- Modify: `src/shared/api.ts`

**Step 1: Read the file to find ModelInfo and geminiModels**

Read `src/shared/api.ts` and locate:
- The `ModelInfo` interface definition
- The `geminiModels` object
- Each Gemini 3.x model entry

**Step 2: Add flag to ModelInfo interface**

After `supportsImages?: boolean`, add:

```typescript
supportsComputerUse?: boolean
```

**Step 3: Set flag on Gemini 3.x models**

For each of these models in `geminiModels` (and `vertexModels` if they exist there too):
- `"gemini-3.1-pro-preview"`: add `supportsComputerUse: true`
- `"gemini-3-pro-preview"`: add `supportsComputerUse: true`
- `"gemini-3-flash-preview"`: add `supportsComputerUse: true`

**Step 4: Commit**

```bash
git add src/shared/api.ts
git commit -m "feat: add supportsComputerUse flag to Gemini 3.x model definitions"
```

---

## Task 5: Create ComputerUseExecutor

Maps CU action names to Puppeteer commands via BrowserSession.

**Files:**
- Create: `src/services/browser/ComputerUseExecutor.ts`
- Test: `src/services/browser/__tests__/ComputerUseExecutor.test.ts`

**Step 1: Write tests for coordinate conversion**

```typescript
import { denormalizeCoordinate } from "@shared/computer-use"

describe("denormalizeCoordinate", () => {
    it("converts 0 to 0", () => {
        expect(denormalizeCoordinate(0, 900)).toBe(0)
    })
    it("converts 1000 to viewport dimension", () => {
        expect(denormalizeCoordinate(1000, 900)).toBe(900)
    })
    it("converts 500 to midpoint", () => {
        expect(denormalizeCoordinate(500, 900)).toBe(450)
    })
    it("handles height dimension", () => {
        expect(denormalizeCoordinate(333, 600)).toBe(200)
    })
})
```

**Step 2: Run test**

Run: `npx jest src/services/browser/__tests__/ComputerUseExecutor.test.ts`
Expected: PASS (denormalizeCoordinate is already implemented in Task 3)

**Step 3: Implement ComputerUseExecutor**

Create `src/services/browser/ComputerUseExecutor.ts`:

```typescript
import { BrowserActionResult } from "@shared/ExtensionMessage"
import {
    BROWSER_LAUNCH_ACTIONS,
    denormalizeCoordinate,
    isComputerUseAction,
} from "@shared/computer-use"
import { BrowserSession } from "./BrowserSession"

export class ComputerUseExecutor {
    constructor(
        private browserSession: BrowserSession,
        private viewportWidth: number,
        private viewportHeight: number,
    ) {}

    updateBrowserSession(session: BrowserSession): void {
        this.browserSession = session
    }

    needsBrowserLaunch(actionName: string): boolean {
        return BROWSER_LAUNCH_ACTIONS.has(actionName)
    }

    async executeAction(
        actionName: string,
        args: Record<string, unknown>,
    ): Promise<BrowserActionResult> {
        if (!isComputerUseAction(actionName)) {
            throw new Error(`Unknown Computer Use action: ${actionName}`)
        }

        switch (actionName) {
            case "click_at": {
                const px = denormalizeCoordinate(Number(args.x), this.viewportWidth)
                const py = denormalizeCoordinate(Number(args.y), this.viewportHeight)
                return this.browserSession.click(`${px},${py}`)
            }

            case "type_text_at": {
                const px = denormalizeCoordinate(Number(args.x), this.viewportWidth)
                const py = denormalizeCoordinate(Number(args.y), this.viewportHeight)
                await this.browserSession.click(`${px},${py}`)
                return this.browserSession.type(String(args.text))
            }

            case "scroll_document": {
                return String(args.direction) === "up"
                    ? this.browserSession.scrollUp()
                    : this.browserSession.scrollDown()
            }

            case "scroll_at": {
                const px = denormalizeCoordinate(Number(args.x), this.viewportWidth)
                const py = denormalizeCoordinate(Number(args.y), this.viewportHeight)
                const delta = Number(args.magnitude ?? 3) * 100
                const dir = String(args.direction)
                return this.browserSession.doAction(async (page) => {
                    await page.mouse.move(px, py)
                    if (dir === "up" || dir === "down") {
                        await page.mouse.wheel({
                            deltaY: dir === "down" ? delta : -delta,
                        })
                    } else {
                        await page.mouse.wheel({
                            deltaX: dir === "right" ? delta : -delta,
                        })
                    }
                })
            }

            case "hover_at": {
                const px = denormalizeCoordinate(Number(args.x), this.viewportWidth)
                const py = denormalizeCoordinate(Number(args.y), this.viewportHeight)
                return this.browserSession.doAction(async (page) => {
                    await page.mouse.move(px, py)
                })
            }

            case "key_combination": {
                const keys = args.keys as string[]
                return this.browserSession.doAction(async (page) => {
                    const modifiers = keys.slice(0, -1)
                    const finalKey = keys[keys.length - 1]
                    for (const mod of modifiers) {
                        await page.keyboard.down(mod)
                    }
                    await page.keyboard.press(finalKey)
                    for (const mod of modifiers.reverse()) {
                        await page.keyboard.up(mod)
                    }
                })
            }

            case "drag_and_drop": {
                const sx = denormalizeCoordinate(Number(args.startX), this.viewportWidth)
                const sy = denormalizeCoordinate(Number(args.startY), this.viewportHeight)
                const ex = denormalizeCoordinate(Number(args.endX), this.viewportWidth)
                const ey = denormalizeCoordinate(Number(args.endY), this.viewportHeight)
                return this.browserSession.doAction(async (page) => {
                    await page.mouse.move(sx, sy)
                    await page.mouse.down()
                    await page.mouse.move(ex, ey, { steps: 10 })
                    await page.mouse.up()
                })
            }

            case "navigate": {
                return this.browserSession.navigateToUrl(String(args.url))
            }

            case "go_back": {
                return this.browserSession.doAction(async (page) => {
                    await page.goBack({
                        waitUntil: "domcontentloaded",
                        timeout: 7000,
                    })
                })
            }

            case "go_forward": {
                return this.browserSession.doAction(async (page) => {
                    await page.goForward({
                        waitUntil: "domcontentloaded",
                        timeout: 7000,
                    })
                })
            }

            case "open_web_browser": {
                return this.browserSession.navigateToUrl("about:blank")
            }

            case "search": {
                const query = String(args.query || "")
                return this.browserSession.navigateToUrl(
                    `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                )
            }

            case "wait_5_seconds": {
                await new Promise((r) => setTimeout(r, 5000))
                return this.browserSession.doAction(async () => {
                    // No-op — just capture screenshot after wait
                })
            }

            default:
                throw new Error(`Unimplemented Computer Use action: ${actionName}`)
        }
    }
}
```

**Step 4: Commit**

```bash
git add src/services/browser/ComputerUseExecutor.ts src/services/browser/__tests__/ComputerUseExecutor.test.ts
git commit -m "feat: add ComputerUseExecutor mapping CU actions to Puppeteer commands"
```

---

## Task 6: Create ComputerUseToolHandler

**Files:**
- Create: `src/core/task/tools/handlers/ComputerUseToolHandler.ts`

**Step 1: Read existing BrowserToolHandler for reference**

Read `src/core/task/tools/handlers/BrowserToolHandler.ts` to understand:
- The `IFullyManagedTool` interface usage
- Approval flow (`askApprovalAndPushFeedback`)
- How screenshots are returned
- UI messages (`say` types used)

**Step 2: Read ToolResultUtils for approval helpers**

Read `src/core/task/tools/utils/ToolResultUtils.ts` to find `askApprovalAndPushFeedback` or equivalent.

**Step 3: Implement ComputerUseToolHandler**

Create `src/core/task/tools/handlers/ComputerUseToolHandler.ts`:

```typescript
import { ClineDefaultTool } from "@shared/tools"
import { BROWSER_LAUNCH_ACTIONS, isComputerUseAction } from "@shared/computer-use"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class ComputerUseToolHandler implements IFullyManagedTool {
    readonly name = ClineDefaultTool.COMPUTER_USE

    getDescription(block: ToolUse): string {
        const action = block.params.cu_action || "unknown"
        return `[Computer Use: ${action}]`
    }

    async handlePartialBlock(
        block: ToolUse,
        ui: StronglyTypedUIHelpers,
    ): Promise<void> {
        // Reuse existing browser_action UI message type
        await ui.say(
            "browser_action",
            JSON.stringify({
                action: block.params.cu_action,
                ...block.params,
            }),
            undefined,
            undefined,
            block.partial,
        )
    }

    async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
        const actionName = block.params.cu_action as string
        if (!actionName || !isComputerUseAction(actionName)) {
            config.taskState.consecutiveMistakeCount++
            return formatResponse.toolError(
                `Unknown Computer Use action: ${actionName}`,
            )
        }

        // Build args from params (excluding the routing param)
        const args: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(block.params)) {
            if (key !== "cu_action") {
                args[key] = value
            }
        }

        const cuExecutor = config.services.computerUseExecutor
        if (!cuExecutor) {
            return formatResponse.toolError(
                "Computer Use is not available. The current model may not support it.",
            )
        }

        try {
            // Auto-launch browser for navigate/open/search actions
            if (BROWSER_LAUNCH_ACTIONS.has(actionName)) {
                const browser = config.services.browserSession
                if (!browser.getConnectionInfo().isConnected) {
                    const url = String(args.url || "about:blank")

                    // Check auto-approval
                    const autoApproved = config.callbacks.shouldAutoApproveTool(
                        ClineDefaultTool.BROWSER,
                    )
                    if (!autoApproved) {
                        // Ask user for approval
                        const { response } = await config.callbacks.ask(
                            "browser_action_launch",
                            url,
                        )
                        if (response !== "yesButtonClicked") {
                            return formatResponse.toolDenied()
                        }
                    } else {
                        await config.callbacks.say(
                            "browser_action_launch",
                            url,
                        )
                    }

                    // Apply settings and launch
                    config.services.browserSession =
                        await config.callbacks.applyLatestBrowserSettings()
                    cuExecutor.updateBrowserSession(config.services.browserSession)
                    await config.services.browserSession.launchBrowser()
                }
            }

            config.taskState.consecutiveMistakeCount = 0

            // Execute the CU action
            const result = await cuExecutor.executeAction(actionName, args)

            // Show screenshot in UI
            await config.callbacks.say(
                "browser_action_result",
                JSON.stringify(result),
            )

            // Return result with screenshot for the model
            return formatResponse.toolResult(
                `Computer Use "${actionName}" executed.\n` +
                `URL: ${result.currentUrl || "(unknown)"}\n` +
                `Console: ${result.logs || "(none)"}`,
                result.screenshot ? [result.screenshot] : [],
            )
        } catch (error) {
            await config.services.browserSession.closeBrowser()
            throw error
        }
    }
}
```

**Step 4: Verify the imports resolve**

Check that these imports exist and are correct:
- `formatResponse` from `../../../prompts/responses` — verify `toolError`, `toolDenied`, `toolResult`
- `IFullyManagedTool` from `../ToolExecutorCoordinator`
- `ClineDefaultTool` from `@shared/tools`

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/core/task/tools/handlers/ComputerUseToolHandler.ts
git commit -m "feat: add ComputerUseToolHandler for CU action execution"
```

---

## Task 7: Add CU Normalization to StreamResponseHandler

This is the critical routing change. Follows the MCP tool normalization pattern exactly.

**Files:**
- Modify: `src/core/task/StreamResponseHandler.ts`

**Step 1: Read the current getPartialToolUsesAsContent()**

Read `src/core/task/StreamResponseHandler.ts` and find:
- The `getPartialToolUsesAsContent()` method
- The MCP tool check (`pending.name.includes(CLINE_MCP_TOOL_IDENTIFIER)`)
- How params are constructed from `pending.parsedInput`

**Step 2: Add CU normalization after MCP check**

Import at the top of the file:
```typescript
import { isComputerUseAction } from "@shared/computer-use"
import { ClineDefaultTool } from "@shared/tools"
```

In `getPartialToolUsesAsContent()`, after the MCP check block and before the `else` default block, add:

```typescript
// After: if (pending.name.includes(CLINE_MCP_TOOL_IDENTIFIER)) { ... }
// Add:
else if (isComputerUseAction(pending.name)) {
    // Normalize CU action to COMPUTER_USE (same pattern as MCP)
    const params: Record<string, string> = {
        cu_action: pending.name,
    }
    if (typeof input === "object" && input !== null) {
        for (const [key, value] of Object.entries(input)) {
            params[key] = typeof value === "string" ? value : JSON.stringify(value)
        }
    }
    results.push({
        type: "tool_use",
        name: ClineDefaultTool.COMPUTER_USE,
        params: params as any,
        partial: true,
        isNativeToolCall: true,
        signature: pending.signature,
        call_id: pending.call_id,
    })
}
// Existing: else { ... normal tool handling ... }
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/core/task/StreamResponseHandler.ts
git commit -m "feat: add CU action normalization in StreamResponseHandler (MCP pattern)"
```

---

## Task 8: Register Handler and Update Browser Close Logic

**Files:**
- Modify: `src/core/task/ToolExecutor.ts`

**Step 1: Read ToolExecutor to find registration and close logic**

Read `src/core/task/ToolExecutor.ts` and find:
- `registerToolHandlers()` method (~line 211)
- Browser close logic (~line 393)

**Step 2: Add imports**

```typescript
import { ComputerUseToolHandler } from "./tools/handlers/ComputerUseToolHandler"
```

**Step 3: Register the CU handler**

In `registerToolHandlers()`, after `this.coordinator.register(new BrowserToolHandler())`:

```typescript
this.coordinator.register(new BrowserToolHandler())
this.coordinator.register(new ComputerUseToolHandler())  // NEW
```

**Step 4: Update browser close logic**

Replace:
```typescript
if (block.name !== "browser_action") {
    await this.browserSession.closeBrowser()
}
```

With:
```typescript
if (block.name !== ClineDefaultTool.BROWSER
    && block.name !== ClineDefaultTool.COMPUTER_USE) {
    await this.browserSession.closeBrowser()
}
```

Add import for `ClineDefaultTool` if not already imported.

**Step 5: Verify build**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```bash
git add src/core/task/ToolExecutor.ts
git commit -m "feat: register ComputerUseToolHandler and update browser close logic"
```

---

## Task 9: Add computerUseExecutor to TaskServices

**Files:**
- Modify: `src/core/task/tools/types/TaskConfig.ts`
- Modify: `src/core/task/tools/utils/ToolConstants.ts`

**Step 1: Add to TaskServices interface**

In `src/core/task/tools/types/TaskConfig.ts`, add to `TaskServices`:

```typescript
import { ComputerUseExecutor } from "@services/browser/ComputerUseExecutor"

export interface TaskServices {
    // ... existing 9 fields ...
    computerUseExecutor?: ComputerUseExecutor  // NEW
}
```

**Step 2: Add to TASK_SERVICES_KEYS**

In `src/core/task/tools/utils/ToolConstants.ts`, add:

```typescript
export const TASK_SERVICES_KEYS = [
    // ... existing keys ...
    "computerUseExecutor",
] as const
```

**Step 3: Commit**

```bash
git add src/core/task/tools/types/TaskConfig.ts src/core/task/tools/utils/ToolConstants.ts
git commit -m "feat: add computerUseExecutor to TaskServices type"
```

---

## Task 10: Wire Up ComputerUseExecutor in Task Initialization

**Files:**
- Modify: The file where `TaskConfig.services` is constructed

**Step 1: Find where services are populated**

Search for where `browserSession` is assigned to services:

```
grep -rn "services.browserSession" src/core/task/
# or
grep -rn "browserSession:" src/core/task/ | grep -v "test" | grep -v "node_modules"
```

Look for the site where `TaskServices` object is constructed (likely in task initialization or ToolExecutor constructor).

**Step 2: Add computerUseExecutor initialization**

After `browserSession` is assigned, add:

```typescript
import { ComputerUseExecutor } from "@services/browser/ComputerUseExecutor"

// After browserSession is set up:
const viewportWidth = browserSettings?.viewport?.width || 900
const viewportHeight = browserSettings?.viewport?.height || 600
services.computerUseExecutor = new ComputerUseExecutor(
    services.browserSession,
    viewportWidth,
    viewportHeight,
)
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add <modified-file>
git commit -m "feat: wire up ComputerUseExecutor in task services initialization"
```

---

## Task 11: Add computerUse Tool Config to GeminiHandler

**Files:**
- Modify: `src/core/api/providers/gemini.ts`

**Step 1: Read GeminiHandler options and constructor**

Read `src/core/api/providers/gemini.ts` to find:
- The options interface (or constructor params)
- How `info` (ModelInfo) is accessed
- The tool config section (lines 170-179)

**Step 2: Add computerUseEnabled option**

Add to the handler's options/config:

```typescript
computerUseEnabled?: boolean
```

**Step 3: Modify tools config**

Replace the tool config section (lines 170-179):

```typescript
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

**Step 4: Add Environment import**

```typescript
import { Environment } from "@google/genai"
```

**Step 5: Commit**

```bash
git add src/core/api/providers/gemini.ts
git commit -m "feat: add computerUse tool to GeminiHandler API config"
```

---

## Task 12: Remove browser_action from GEMINI_3 Variant

**Files:**
- Modify: `src/core/prompts/system-prompt/variants/gemini-3/config.ts`

**Step 1: Read the config file**

Read `src/core/prompts/system-prompt/variants/gemini-3/config.ts` to find the `.tools()` call.

**Step 2: Remove ClineDefaultTool.BROWSER**

Find `ClineDefaultTool.BROWSER` in the tools list (line ~61) and remove it:

```typescript
// BEFORE:
.tools(
    ClineDefaultTool.BASH,
    ClineDefaultTool.FILE_READ,
    // ...
    ClineDefaultTool.BROWSER,     // REMOVE THIS LINE
    ClineDefaultTool.WEB_FETCH,
    // ...
)

// AFTER:
.tools(
    ClineDefaultTool.BASH,
    ClineDefaultTool.FILE_READ,
    // ...
    // browser_action removed — Computer Use replaces it for Gemini 3
    ClineDefaultTool.WEB_FETCH,
    // ...
)
```

**Step 3: Commit**

```bash
git add src/core/prompts/system-prompt/variants/gemini-3/config.ts
git commit -m "feat: remove browser_action from GEMINI_3 variant (replaced by Computer Use)"
```

---

## Task 13: Pass computerUseEnabled Through Provider Factory

**Files:**
- Modify: `src/core/api/index.ts`

**Step 1: Find where GeminiHandler is instantiated**

Search for `new GeminiHandler(` in the codebase:

```
grep -rn "new GeminiHandler" src/
```

**Step 2: Add computerUseEnabled flag**

Where GeminiHandler is constructed, add:

```typescript
computerUseEnabled: true,  // or derive from settings
```

If browser settings are available at this point:
```typescript
computerUseEnabled: !configuration.browserSettings?.disableToolUse,
```

**Step 3: Commit**

```bash
git add src/core/api/index.ts
git commit -m "feat: pass computerUseEnabled flag to GeminiHandler constructor"
```

---

## Task 14: Add Model Fallback Logic

**Files:**
- Modify: `src/core/api/providers/gemini.ts`

**Step 1: Add fallback before generateContentStream**

In `createMessage()`, before the API call, add fallback logic:

```typescript
let effectiveModelId = modelId
if (this.options.computerUseEnabled && !info.supportsComputerUse) {
    // Model doesn't support CU — fall back to latest CU model
    const fallbackId = "gemini-3-pro-preview"
    const fallbackInfo = geminiModels[fallbackId]
    if (fallbackInfo?.supportsComputerUse) {
        effectiveModelId = fallbackId
        console.info(
            `[GeminiHandler] Model ${modelId} doesn't support Computer Use. ` +
            `Falling back to ${fallbackId}.`,
        )
    }
}
```

Use `effectiveModelId` in the `generateContentStream` call instead of `modelId`.

**Step 2: Commit**

```bash
git add src/core/api/providers/gemini.ts
git commit -m "feat: add model fallback for Computer Use support"
```

---

## Task 15: Build and Integration Test

**Step 1: Full build**

Run: `npm run build`
Expected: No TypeScript errors

**Step 2: Fix any build errors**

Common issues:
- Missing imports (ComputerUseExecutor, Environment, isComputerUseAction)
- Path alias resolution (@shared, @services)
- Type mismatches in params casting

**Step 3: Run existing tests**

Run: `npm test`
Expected: All existing tests still pass

**Step 4: Manual smoke test**

1. Open VS Code with the extension loaded (`F5` debug)
2. Set provider to Gemini with `gemini-3.1-pro-preview`
3. Ask: "Navigate to https://example.com and tell me what you see"
4. Verify:
   - [ ] Browser launches with approval dialog
   - [ ] CU action (navigate) is executed
   - [ ] Screenshot appears in chat
   - [ ] Model responds based on screenshot
   - [ ] Non-browser tools still work (try "read the file package.json")
   - [ ] Browser closes when switching to non-browser tools

5. Test multi-action sequence:
   - "Go to google.com and search for 'test'"
   - Verify click_at and type_text_at actions work

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build errors from Computer Use integration"
```

---

## Summary

| Task | Description | Files | Type |
|------|-------------|-------|------|
| 1 | Fix GeminiHandler missing call_id | gemini.ts | Bug fix |
| 2 | Fix FunctionResponse image handling | gemini-format.ts | Bug fix |
| 3 | Add COMPUTER_USE enum + CU constants | tools.ts, computer-use.ts | New |
| 4 | Add supportsComputerUse model flag | api.ts | Config |
| 5 | Create ComputerUseExecutor | ComputerUseExecutor.ts | New |
| 6 | Create ComputerUseToolHandler | ComputerUseToolHandler.ts | New |
| 7 | Add CU normalization to StreamResponseHandler | StreamResponseHandler.ts | Core routing |
| 8 | Register handler + browser close logic | ToolExecutor.ts | Wiring |
| 9 | Add computerUseExecutor to TaskServices | TaskConfig.ts, ToolConstants.ts | Type |
| 10 | Wire up executor in task init | (find site) | Wiring |
| 11 | Add computerUse tool to GeminiHandler | gemini.ts | API config |
| 12 | Remove browser_action from GEMINI_3 | config.ts | Config |
| 13 | Pass computerUseEnabled flag | index.ts | Wiring |
| 14 | Model fallback logic | gemini.ts | Feature |
| 15 | Build + integration test | — | Verification |

**Total: 15 tasks, 3 new files, ~10 modified files**

**Dependency graph:**
```
Task 1 (call_id fix) ──┐
Task 2 (image fix)  ───┤
Task 3 (constants)  ───┼── All independent, can be parallelized
Task 4 (model flag) ───┘
                        │
Task 5 (executor)   ────┤── Depends on Task 3 (imports from computer-use.ts)
                        │
Task 6 (handler)    ────┤── Depends on Task 3 + Task 5
Task 7 (routing)    ────┤── Depends on Task 3
                        │
Task 8 (register)   ────┤── Depends on Task 6
Task 9 (types)      ────┤── Depends on Task 5 (imports ComputerUseExecutor)
Task 10 (wiring)    ────┤── Depends on Task 5 + Task 9
                        │
Task 11 (API config) ───┤── Depends on Task 4
Task 12 (variant)   ────┤── Independent
Task 13 (flag pass) ────┤── Depends on Task 11
Task 14 (fallback)  ────┤── Depends on Task 4 + Task 11
                        │
Task 15 (test)      ────┘── Depends on ALL above
```

**Parallelizable groups:**
- Group A (independent): Tasks 1, 2, 3, 4 (all at once)
- Group B (after A): Tasks 5, 7, 12 (all at once)
- Group C (after B): Tasks 6, 9, 11 (all at once)
- Group D (after C): Tasks 8, 10, 13, 14 (all at once)
- Group E (after D): Task 15
