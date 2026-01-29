import type { ApiProviderInfo } from "@/core/api"
import { getDeepPlanningPrompt } from "./commands/deep-planning"

export const newTaskToolResponse = (willUseNativeTools: boolean) => {
	const xmlExample = `
Example:
<new_task>
<context>1. Current Work:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Relevant Files and Code:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Problem Solving:
   [Detailed description]

5. Pending Tasks and Next Steps:
   - [Task 1 details & next steps]
   - [Task 2 details & next steps]
   - [...]</context>
</new_task>
`

	return `<explicit_instructions type="new_task">
The user has explicitly asked you to help them create a new task with preloaded context, which you will generate. The user may have provided instructions or additional information for you to consider when summarizing existing work and creating the context for the new task.
Irrespective of whether additional information or instructions are given, you are ONLY allowed to respond to this message by calling the new_task tool.${willUseNativeTools ? " You MUST call the new_task tool EVEN if it's not in your existing toolset." : ""}

The new_task tool is defined below:

Description:
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the new task.
The user will be presented with a preview of your generated context and can choose to create a new task or keep chatting in the current conversation.

Parameters:
- Context: (required) The context to preload the new task with. If applicable based on the current task, this should include:
  1. Current Work: Describe in detail what was being worked on prior to this request to create a new task. Pay special attention to the more recent messages / conversation.
  2. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for the new task.
  3. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  4. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  5. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.
${xmlExample}
Below is the the user's input when they indicated that they wanted to create a new task.
</explicit_instructions>\n
`
}

export const condenseToolResponse = (focusChainSettings?: { enabled: boolean }) =>
	`<explicit_instructions type="condense">
The user has explicitly asked you to create a detailed summary of the conversation so far, which will be used to compact the current context window while retaining key information. The user may have provided instructions or additional information for you to consider when summarizing the conversation.
Irrespective of whether additional information or instructions are given, you are only allowed to respond to this message by calling the condense tool.

The condense tool is defined below:

Description:
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.
The user will be presented with a preview of your generated summary and can choose to use it to compact their context window or keep chatting in the current conversation.
Users may refer to this tool as 'smol' or 'compact' as well. You should consider these to be equivalent to 'condense' when used in a similar context.

Parameters:
- Context: (required) The context to continue the conversation with. If applicable based on the current task, this should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  2. Current Work: Describe in detail what was being worked on prior to this request to compact the context window. Pay special attention to the more recent messages / conversation.
  3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.
${
	focusChainSettings?.enabled
		? `- task_progress: (required) The current state of the task_progress list, with completed items marked. Important information on this parameter is as follows:
  1. XML schema matches that of prior task_progress lists.
  2. All items are retained, with the exact same desciptive content as in prior occurences.
  3. All completed items are marked as completed.
  4. The only compenent of this list that can be changed is the completion state of invidiual items in the list`
		: ""
}

Usage:
<condense>
<context>Your detailed summary</context>
${focusChainSettings?.enabled ? `<task_progress>task_progress list here</task_progress>` : ""}
</condense>

Example:
<condense>
<context>
1. Previous Conversation:
  [Detailed description]

2. Current Work:
  [Detailed description]

3. Key Technical Concepts:
  - [Concept 1]
  - [Concept 2]
  - [...]

4. Relevant Files and Code:
  - [File Name 1]
    - [Summary of why this file is important]
    - [Summary of the changes made to this file, if any]
    - [Important Code Snippet]
  - [File Name 2]
    - [Important Code Snippet]
  - [...]

5. Problem Solving:
  [Detailed description]

6. Pending Tasks and Next Steps:
  - [Task 1 details & next steps]
  - [Task 2 details & next steps]
  - [...]
</context>
${
	focusChainSettings?.enabled
		? `<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
- [ ] Test application
</task_progress>`
		: ""
}
</condense>

</explicit_instructions>\n
`

export const newRuleToolResponse = () =>
	`<explicit_instructions type="new_rule">
The user has explicitly asked you to help them create a new Cline rule file inside the .clinerules top-level directory based on the conversation up to this point in time. The user may have provided instructions or additional information for you to consider when creating the new Cline rule.
When creating a new Cline rule file, you should NOT overwrite or alter an existing Cline rule file. To create the Cline rule file you MUST use the new_rule tool. The new_rule tool can be used in either of the PLAN or ACT modes.

The new_rule tool is defined below:

Description:
Your task is to create a new Cline rule file which includes guidelines on how to approach developing code in tandem with the user, which can be either project specific or cover more global rules. This includes but is not limited to: desired conversational style, favorite project dependencies, coding styles, naming conventions, architectural choices, ui/ux preferences, etc.
The Cline rule file must be formatted as markdown and be a '.md' file. The name of the file you generate must be as succinct as possible and be encompassing the main overarching concept of the rules you added to the file (e.g., 'memory-bank.md' or 'project-overview.md').

Parameters:
- Path: (required) The path of the file to write to (relative to the current working directory). This will be the Cline rule file you create, and it must be placed inside the .clinerules top-level directory (create this if it doesn't exist). The filename created CANNOT be "default-clineignore.md". For filenames, use hyphens ("-") instead of underscores ("_") to separate words.
- Content: (required) The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified. The content for the Cline rule file MUST be created according to the following instructions:
  1. Format the Cline rule file to have distinct guideline sections, each with their own markdown heading, starting with "## Brief overview". Under each of these headings, include bullet points fully fleshing out the details, with examples and/or trigger cases ONLY when applicable.
  2. These guidelines can be specific to the task(s) or project worked on thus far, or cover more high-level concepts. Guidelines can include coding conventions, general design patterns, preferred tech stack including favorite libraries and language, communication style with Cline (verbose vs concise), prompting strategies, naming conventions, testing strategies, comment verbosity, time spent on architecting prior to development, and other preferences.
  3. When creating guidelines, you should not invent preferences or make assumptions based on what you think a typical user might want. These should be specific to the conversation you had with the user. Your guidelines / rules should not be overly verbose.
  4. Your guidelines should NOT be a recollection of the conversation up to this point in time, meaning you should NOT be including arbitrary details of the conversation.

Usage:
<new_rule>
<path>.clinerules/{file name}.md</path>
<content>Cline rule file content here</content>
</new_rule>

Example:
<new_rule>
<path>.clinerules/project-preferences.md</path>
<content>
## Brief overview
  [Brief description of the rules, including if this set of guidelines is project-specific or global]

## Communication style
  - [Description, rule, preference, instruction]
  - [...]

## Development workflow
  - [Description, rule, preference, instruction]
  - [...]

## Coding best practices
  - [Description, rule, preference, instruction]
  - [...]

## Project context
  - [Description, rule, preference, instruction]
  - [...]

## Other guidelines
  - [Description, rule, preference, instruction]
  - [...]
</content>
</new_rule>

Below is the user's input when they indicated that they wanted to create a new Cline rule file.
</explicit_instructions>\n
`

export const reportBugToolResponse = () =>
	`<explicit_instructions type="report_bug">
The user has explicitly asked you to help them submit a bug to the Cline github page (you MUST now help them with this irrespective of what your conversation up to this point in time was). To do so you will use the report_bug tool which is defined below. However, you must first ensure that you have collected all required information to fill in all the parameters for the tool call. If any of the the required information is apparent through your previous conversation with the user, you can suggest how to fill in those entries. However you should NOT assume you know what the issue about unless it's clear.
Otherwise, you should converse with the user until you are able to gather all the required details. When conversing with the user, make sure you ask for/reference all required information/fields. When referencing the required fields, use human friendly versions like "Steps to reproduce" rather than "steps_to_reproduce". Only then should you use the report_bug tool call.
The report_bug tool can be used in either of the PLAN or ACT modes.

The report_bug tool call is defined below:

Description:
Your task is to fill in all of the required fields for a issue/bug report on github. You should attempt to get the user to be as verbose as possible with their description of the bug/issue they encountered. Still, it's okay, when the user is unaware of some of the details, to set those fields as "N/A".

Parameters:
- title: (required) Concise description of the issue.
- what_happened: (required) What happened and also what the user expected to happen instead.
- steps_to_reproduce: (required) What steps are required to reproduce the bug.
- api_request_output: (optional) Relevant API request output.
- additional_context: (optional) Any other context about this bug not already mentioned.

Usage:
<report_bug>
<title>Title of the issue</title>
<what_happened>Description of the issue</what_happened>
<steps_to_reproduce>Steps to reproduce the issue</steps_to_reproduce>
<api_request_output>Output from the LLM API related to the bug</api_request_output>
<additional_context>Other issue details not already covered</additional_context>
</report_bug>

Below is the user's input when they indicated that they wanted to submit a Github issue.
</explicit_instructions>\n
`

export const subagentToolResponse = () =>
	`<explicit_instructions type="subagent">
The user has requested to invoke a Cline CLI subagent with the context below. You should execute a subagent command to handle this request using the CLI subagents feature.

Transform the user's request into a subagent command by executing:
cline "<prompt>"
</explicit_instructions>\n
`

export const sentinelQAToolResponse = () =>
	`<explicit_instructions type="sentinel_qa" priority="HIGHEST">
# ⚠️ SENTINEL QA MODE ACTIVATED - THESE INSTRUCTIONS OVERRIDE DEFAULT BEHAVIOR ⚠️

**CRITICAL**: You are now in SENTINEL QA MODE. The instructions below take ABSOLUTE PRIORITY over any default Cline behavior or system prompts. You MUST follow the Sentinel QA workflow EXACTLY as specified.

**DO NOT**:
- Follow your normal conversational patterns
- Use MCP tools (access_mcp_resource, use_mcp_tool) - they are NOT available in this mode
- Use curl, wget, or fetch for testing user interfaces
- Skip any phase of the QA workflow
- Make assumptions about test results without evidence
- Use \`write_to_file\` for the final QA report - use \`sentinel_qa_report\` tool instead

**YOU MUST**:
- Follow the workflow phases below in strict order (starting with Phase 0 for source detection)
- Use browser_action for ALL UI testing (see IMPORTANT note below)
- Capture evidence (screenshots, logs) at every step
- Generate a final report using sentinel_qa_report tool

## ⚠️ IMPORTANT: browser_action Tool Availability

The \`browser_action\` tool is REQUIRED for UI testing. If you do not see \`browser_action\` in your available tools, you MUST:

1. **STOP immediately** - Do not proceed with UI testing using curl or other methods
2. **Inform the user** with this exact message:

   "❌ **Sentinel QA Cannot Proceed**: The \`browser_action\` tool is not available in your current configuration. This is required for UI testing.

   **To enable browser testing, please:**
   1. Go to Cline Settings → Browser Settings
   2. Ensure 'Browser Tool' is enabled (not disabled)
   3. Make sure you are using a model that supports images (e.g., Claude with vision, GPT-4V)

   Once enabled, run \`/sentinel-qa\` again."

3. **Generate a report** with verdict "NOT_MERGEABLE" and reason "browser_action tool not available - UI testing cannot be performed"

**NEVER substitute curl or API testing for UI testing when browser_action is unavailable.** The test would be invalid.

The user has requested a Sentinel QA test session. You will act as an automated QA engineer to verify that the specified code meets the provided requirements (PRD/spec).

# SENTINEL QA WORKFLOW

You must follow these phases in order:

## Phase 0: Test Source Detection & Preparation

**IMPORTANT**: Before starting test planning, you MUST detect the test source from the user's input and prepare accordingly.

Check for these parameters in the user's message:
- \`--source=uncommitted\`: Test uncommitted changes in workspace
- \`--source=pr --pr=<value>\`: Test changes from a Pull Request
- No \`--source\` flag: Use file mentions (@) or manual file selection (default behavior)

### 0.1 Uncommitted Changes Mode (\`--source=uncommitted\`)

When the user requests testing of uncommitted changes:

1. **Check for changes**: Run \`git status\` to check if there are uncommitted changes
2. **Get changed files**: Run \`git diff HEAD --name-only\` to get the list of modified files
3. **Get full diff**: Run \`git --no-pager diff HEAD\` to see the actual changes
4. **Identify target files**: The changed files become your test targets

If no uncommitted changes exist, inform the user and ask them to either:
- Make some changes to test
- Switch to a different test source mode

### 0.2 PR-Based Testing Mode (\`--source=pr --pr=<value>\`)

When the user provides a PR URL or number:

1. **⚠️ CRITICAL - User Confirmation Required**: Before switching branches, you MUST use \`ask_followup_question\` to get user confirmation:

\`\`\`
⚠️ **Branch Switch Required**

To test PR changes, Sentinel needs to checkout the PR branch. Please confirm:

- Your current uncommitted changes may be affected
- It's recommended to commit or stash your work first

**Current branch status:**
[Show output of \`git status --short\`]

Do you want to proceed with switching to the PR branch? (yes/no)
\`\`\`

2. **Parse PR input**: The value can be:
   - Full URL: \`https://github.com/owner/repo/pull/123\` → Extract PR number \`123\`
   - Short format: \`#123\` or just \`123\` → Use directly

3. **After user confirms YES**, execute these git/gh commands:
   - \`gh pr checkout <number>\` - Switch to the PR branch
   - \`gh pr view <number> --json title,body,headRefName,baseRefName,changedFiles\` - Get PR metadata
   - \`gh pr diff <number> | cat\` - Get the full diff of PR changes

4. **Identify test targets**: Use the PR's changed files as your test targets

5. **If user says NO**: Inform them they can:
   - Commit/stash their changes and try again
   - Use a different test source mode

### 0.3 File Selection Mode (Default)

When no \`--source\` flag is provided:
- Use files mentioned with @ in the user's message
- Use files/paths provided in the PRD description
- If no files specified, ask the user to specify target files

---

After completing Phase 0, proceed to Phase 1 with the identified target files.

## Phase 1: Analysis & Test Planning

1. **Read Target Files**: Read all files specified by the user (via @ mentions or paths)
2. **Understand Requirements**: Analyze the PRD/spec provided by the user
3. **Identify Test Scenarios**: Create a structured test plan covering:
   - **Functional tests**: Does the main feature work as specified?
   - **Edge cases**: Error handling, boundary conditions, invalid inputs
   - **Integration tests**: Component interactions, API calls
   - **UI/UX verification**: If applicable, visual and interaction checks

### Step 1.1: Generate Visual Test Plan Document

**REQUIRED**: Create a visual test plan document with a clean tree-style diagram (left-to-right layout).

Use \`write_to_file\` to create a file named \`sentinel_test_plan_<timestamp>.md\` in the project root with this structure:

\`\`\`markdown
# 🎯 Sentinel QA Test Plan

> **Generated**: <current_date_time>  
> **Target**: <file_or_feature_name>  
> **PRD**: <brief_summary_of_requirements>

---

## 📊 Test Coverage Tree

\`\`\`mermaid
flowchart LR
    subgraph ROOT[" "]
        TP[🎯 Test Plan]
    end
    
    subgraph FUNC["🟢 Functional"]
        F1[TC001]
        F2[TC002]
    end
    
    subgraph EDGE["🟡 Edge Cases"]
        E1[TC003]
        E2[TC004]
    end
    
    subgraph ERROR["🔴 Error Handling"]
        R1[TC005]
        R2[TC006]
    end
    
    subgraph UIUX["🔵 UI/UX"]
        U1[TC007]
        U2[TC008]
    end
    
    TP --> FUNC
    TP --> EDGE
    TP --> ERROR
    TP --> UIUX
    
    F1 --> F1D[Login Success Flow]
    F2 --> F2D[Core Feature Works]
    
    E1 --> E1D[Empty/Invalid Input]
    E2 --> E2D[Boundary Values]
    
    R1 --> R1D[Network Failure]
    R2 --> R2D[Auth Failure]
    
    U1 --> U1D[Responsive Layout]
    U2 --> U2D[Accessibility]
\`\`\`

---

## 📋 Detailed Test Cases

### 🟢 Functional Tests (Happy Path)

| ID | Test Case | Steps | Expected Result | Priority |
|:---|:----------|:------|:----------------|:---------|
| TC001 | <name> | 1. <step1><br>2. <step2> | <expected> | 🔴 High |
| TC002 | <name> | 1. <step1><br>2. <step2> | <expected> | 🔴 High |

### 🟡 Edge Cases (Boundary Conditions)

| ID | Test Case | Input Scenario | Expected Result | Priority |
|:---|:----------|:---------------|:----------------|:---------|
| TC003 | <name> | <input_scenario> | <expected> | 🟠 Medium |
| TC004 | <name> | <input_scenario> | <expected> | 🟠 Medium |

### 🔴 Error Handling (Failure Scenarios)

| ID | Test Case | Error Scenario | Expected Result | Priority |
|:---|:----------|:---------------|:----------------|:---------|
| TC005 | <name> | <error_scenario> | <expected> | 🔴 High |
| TC006 | <name> | <error_scenario> | <expected> | 🔴 High |

### 🔵 UI/UX Verification

| ID | Test Case | Verification | Expected Result | Priority |
|:---|:----------|:-------------|:----------------|:---------|
| TC007 | <name> | <ui_check> | <expected> | 🟢 Low |
| TC008 | <name> | <ui_check> | <expected> | 🟢 Low |

---

## 🔄 Test Execution Flow

\`\`\`mermaid
flowchart LR
    subgraph Phase1["Phase 1: Setup"]
        A[Start] --> B[Inject Logs]
        B --> C[Start Server]
    end
    
    subgraph Phase2["Phase 2: Functional"]
        D[TC001] --> E[TC002]
    end
    
    subgraph Phase3["Phase 3: Edge Cases"]
        F[TC003] --> G[TC004]
    end
    
    subgraph Phase4["Phase 4: Errors"]
        H[TC005] --> I[TC006]
    end
    
    subgraph Phase5["Phase 5: UI/UX"]
        J[TC007] --> K[TC008]
    end
    
    subgraph Phase6["Phase 6: Report"]
        L[Cleanup] --> M[Generate Report]
    end
    
    Phase1 --> Phase2
    Phase2 --> Phase3
    Phase3 --> Phase4
    Phase4 --> Phase5
    Phase5 --> Phase6
\`\`\`

---

## 📌 Legend

| Symbol | Meaning |
|:------:|:--------|
| 🟢 | Functional / Low Priority |
| 🟡 | Edge Case / Medium Priority |
| 🔴 | Error / High Priority |
| 🔵 | UI/UX |
| ⬜ | Pending |
| ✅ | Passed |
| ❌ | Failed |
| ⏭️ | Skipped |
\`\`\`

**Customize the tree diagram based on the actual test scenarios you identify. Keep the left-to-right flow structure.**

## Legend

- 🟢 **Functional**: Core feature verification
- 🟡 **Edge Case**: Boundary and unusual inputs
- 🔴 **Error**: Failure scenario handling  
- 🔵 **UI/UX**: Visual and interaction checks
- ⚪ **Pending** | ✅ **Passed** | ❌ **Failed** | ⏭️ **Skipped**
\`\`\`

**Customize the mindmap and flow diagram based on the actual test scenarios you identify.**

### Step 1.2: Output Summary in Chat

Also output a brief summary in chat:
\`\`\`
TEST PLAN:
1. [test_id] [category] - [description]
   Expected: [what should happen]
2. ...

📄 Full visual test plan saved to: sentinel_test_plan_<timestamp>.md
\`\`\`

## Phase 2: Log Injection (REQUIRED - DO NOT SKIP)

⚠️ **THIS PHASE IS MANDATORY** - You MUST inject logging statements BEFORE starting the dev server or browser tests.

To capture evidence during test execution, inject temporary logging statements into the code.

**Log Marker Format**: \`// SENTINEL_TEST_LOG: <test_id>\`
**Console Log Format**: \`console.log('SENTINEL_TEST_LOG: <test_id> - <description>', <relevant_data>);\`

**Where to inject logs:**
1. **Authentication/Login flows**: After login success/failure handlers
2. **Form submissions**: Before and after form validation
3. **API calls**: After response handling
4. **Error handlers**: In catch blocks and error boundaries
5. **State changes**: When critical state updates occur

Example:
\`\`\`javascript
// SENTINEL_TEST_LOG: login_success
console.log('SENTINEL_TEST_LOG: login_success - User authenticated', { userId, timestamp });

// SENTINEL_TEST_LOG: login_failure  
console.log('SENTINEL_TEST_LOG: login_failure - Authentication failed', { error, email });
\`\`\`

**MANDATORY Requirements**:
- ✅ MUST inject logs at ALL critical verification points listed in your test plan
- ✅ MUST inject BEFORE Phase 3 (starting dev server)
- ✅ MUST track all injected logs for cleanup later
- ✅ Use the write_to_file or apply_patch tool for injection
- ❌ DO NOT skip this phase - logs are essential evidence for test verification

## Phase 3: Build & Run

1. **Install dependencies**: Run \`npm install\` (or equivalent for the project type)
2. **Start dev server**: Run \`npm run dev\` (or equivalent)
3. **Wait for ready**: Check if the server is running and accessible
4. **Verify health**: Confirm the app is responding (e.g., check localhost URL)

If build or server fails, **stop immediately** and report the failure.

## Phase 4: E2E Testing with Browser

**CRITICAL: You MUST use the browser_action tool for ALL UI testing. Do NOT use curl or direct API calls to test user-facing functionality. The goal is to test the application AS A USER WOULD USE IT.**

### Step 4.1: Launch Browser
\`\`\`
browser_action: launch
url: http://localhost:PORT
\`\`\`

### Step 4.2: Execute Test Scenarios
For EACH test in your plan, you MUST:
1. Use \`browser_action\` with action "click" to interact with UI elements
2. Use \`browser_action\` with action "type" to enter text into input fields
3. Take a screenshot BEFORE and AFTER each interaction
4. Check console logs for SENTINEL_TEST_LOG markers

**Example flow for testing login:**
\`\`\`
1. browser_action: launch, url: http://localhost:8080
2. browser_action: type, text: "user@example.com" (in email field)
3. browser_action: type, text: "password123" (in password field)
4. browser_action: click, coordinate: "x,y" (on login button)
5. Verify: Check screenshot for success/error message
6. Verify: Check console logs for SENTINEL_TEST_LOG markers
\`\`\`

### Step 4.3: Record Evidence
- **Screenshots**: Capture at EVERY critical step (before click, after result)
- **Console logs**: Look for SENTINEL_TEST_LOG entries
- **UI state**: Document what you see on screen

**FORBIDDEN**: Using curl, wget, or execute_command to test user flows. These bypass the UI and do not test what users actually experience.

## Phase 5: Cleanup & Report

1. **Remove injected logs**: Use replace_in_file to remove all SENTINEL_TEST_LOG markers
2. **Close browser**: End the browser session
3. **Generate report**: You MUST use the \`sentinel_qa_report\` tool (NOT write_to_file)

**⚠️ IMPORTANT**: Do NOT use \`write_to_file\` for the final report. Use the dedicated \`sentinel_qa_report\` tool which:
- Validates the report structure automatically
- Saves to the workspace directory (not root /)
- Displays the report in the UI properly

**Tool usage:**
\`\`\`
sentinel_qa_report with parameter report_json containing the JSON:
\`\`\`

**Report JSON structure:**
\`\`\`json
{
  "summary": {
    "total_tests": <number>,
    "passed": <number>,
    "failed": <number>,
    "skipped": <number>,
    "verdict": "MERGEABLE" | "NOT_MERGEABLE" | "MERGEABLE_WITH_RISKS"
  },
  "tests": [
    {
      "id": "<test_id>",
      "name": "<human readable name>",
      "category": "functional" | "edge_case" | "integration" | "ui_ux",
      "status": "passed" | "failed" | "skipped",
      "evidence": {
        "logs": ["<captured log lines>"],
        "screenshots": ["<screenshot descriptions>"],
        "notes": "<additional observations>"
      },
      "failure_reason": "<if failed, explain why>"
    }
  ],
  "risks": ["<identified risks or concerns>"],
  "recommendations": ["<suggested improvements>"]
}
\`\`\`

## Verdict Guidelines

- **MERGEABLE**: All critical tests pass, no significant risks
- **NOT_MERGEABLE**: Critical functionality broken, build fails, or major bugs found
- **MERGEABLE_WITH_RISKS**: Main flow works but edge cases fail or minor issues found

⚠️ **CRITICAL**: After generating the report, if ANY tests failed (verdict is NOT "MERGEABLE"), you MUST immediately proceed to Phase 6 to offer the fix option. Do NOT execute any other commands or end the session.

## Phase 6: Fix Issues (MANDATORY WHEN TESTS FAIL)

⚠️ **THIS PHASE IS MANDATORY IF ANY TESTS FAILED** ⚠️

After generating the QA report, you MUST check if any tests failed. If \`summary.failed > 0\` OR verdict is "NOT_MERGEABLE" or "MERGEABLE_WITH_RISKS":

### Step 6.1: MANDATORY - Ask User About Fixes

**YOU MUST use the \`ask_followup_question\` tool** to ask the user if they want fixes. Do NOT skip this step. Do NOT end the session without asking.

Use this EXACT format with the ask_followup_question tool:

\`\`\`
🔧 **Issues Found During Testing**

The following tests failed:
- [TC_ID]: [test name] - [brief failure reason]
- [TC_ID]: [test name] - [brief failure reason]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Would you like me to fix these issues?**

Reply with:
• **"yes"** or **"fix it"** - I'll automatically implement all fixes
• **"no"** - End QA session without fixes  
• **"fix TC001, TC003"** - Fix only specific test failures
\`\`\`

### Step 6.2: If User Requests Fixes

When the user confirms they want fixes:

1. **Analyze each failure**: Review the failure_reason and evidence from the report
2. **Identify root cause**: Examine the code to understand why the test failed
3. **Implement fix**: Use write_to_file or apply_patch to fix the issue
4. **Re-test**: After fixing, re-run the specific failed tests to verify the fix
5. **Update report**: If all fixes pass, update the verdict accordingly

### Step 6.3: Fix Implementation Guidelines

- Fix ONE issue at a time
- Show the user what you're changing before making edits
- After each fix, briefly explain what was changed and why
- If a fix requires multiple file changes, group them logically
- If you cannot determine how to fix an issue, explain why and ask for guidance

### ❌ PROHIBITED ACTIONS AFTER REPORT GENERATION

When you have generated a report with failed tests, you MUST NOT:
- Execute any more commands (like \`node server.js\`)
- Start any new processes
- Continue testing without asking about fixes first
- End the session without offering the fix option

**The ONLY acceptable action after a failed report is to use \`ask_followup_question\` to offer fixes.**

## Important Rules

- ALWAYS read and understand the code BEFORE writing tests
- ALWAYS clean up injected logs after testing
- Take screenshots at EVERY critical verification point
- If build fails, report immediately - do not continue testing
- Evidence-driven: Base your verdict ONLY on observed behavior and logs
- Do not assume functionality works - VERIFY with actual tests

## MANDATORY CONSTRAINTS

**YOU MUST USE browser_action FOR ALL USER-FACING TESTS.**

### Testing Methods by Category:

**For UI/Frontend Testing (login forms, buttons, user interactions):**
- ✅ REQUIRED: Use \`browser_action\` tool
- ❌ FORBIDDEN: curl, wget, fetch, execute_command with HTTP requests

**For API-only Testing (backend endpoints with no UI):**
- ✅ ALLOWED: curl or execute_command for direct API calls
- ⚠️ NOTE: Only use this if the feature is purely API-based with no UI component

**For Build/Server Testing:**
- ✅ ALLOWED: execute_command for npm, build tools, server startup

### Absolute Prohibitions:

- ❌ NEVER use \`access_mcp_resource\` or \`use_mcp_tool\` - MCP is DISABLED in Sentinel QA mode
- ❌ NEVER use \`curl\` or \`wget\` to test login forms, buttons, or UI interactions
- ❌ NEVER skip the browser_action step for UI features
- ❌ NEVER generate a report without actual test evidence

### Required Actions:

- ✅ ALWAYS use \`browser_action\` with action="launch" to open the app URL
- ✅ ALWAYS use \`browser_action\` with action="click" to click buttons/links
- ✅ ALWAYS use \`browser_action\` with action="type" to fill form fields
- ✅ ALWAYS capture screenshots as evidence at EVERY verification step
- ✅ ALWAYS use \`sentinel_qa_report\` tool to generate the final report

If you skip browser testing and use curl instead, your test results will be INVALID because you are not testing the actual user experience.

---
**Remember: You are in SENTINEL QA MODE. Follow this workflow EXACTLY. Do not deviate to normal Cline behavior.**
---

Below is the user's input with their target files and PRD/requirements.
</explicit_instructions>\n
`

export const explainChangesToolResponse = () =>
	`<explicit_instructions type="explain_changes">
The user has asked you to explain code changes. You have access to a tool called **generate_explanation** that opens a multi-file diff view with AI-generated inline comments explaining code changes between two git references.

# Important: Use Non-Interactive Commands

When running git or gh commands, always use non-interactive variants to ensure output is returned immediately without requiring user interaction:

- **For git commands**: Use \`git --no-pager\` prefix to disable the pager (e.g., \`git --no-pager log\`, \`git --no-pager diff\`, \`git --no-pager show\`)
- **For gh commands**: Use \`--json\` flag when possible for structured output, or pipe to \`cat\` if needed (e.g., \`gh pr diff 123 | cat\`)

This prevents commands from entering interactive/pager mode which would hang waiting for user input.

# Workflow

Follow these steps to explain code changes:

## 1. Gather Information About the Changes

First, use git or gh CLI tools to understand what changes exist. **Always get the full unified diff output**, not just stats:

- For commits: \`git --no-pager show <commit>\` to see a specific commit's full diff
- For commit ranges: \`git --no-pager log --oneline <from>..<to>\` to see commits in range, then \`git --no-pager diff <from>..<to>\` for full diff
- For branches: \`git --no-pager diff <branch1>..<branch2>\` to see full diff of all changes
- For pull requests: \`gh pr view <number> --json commits,files\` for metadata, then \`gh pr diff <number> | cat\` for full diff
- For staged changes: \`git --no-pager diff --cached\` to see full diff of staged files
- For working directory: \`git --no-pager diff\` for full diff of unstaged changes

To get a comprehensive overview between two refs, run:

**Bash:**
\`\`\`bash
echo "=== COMMITS ==="; git --no-pager log --oneline <from_ref>..<to_ref>; echo "=== CHANGED FILES ==="; git diff <from_ref>..<to_ref> --name-only; echo "=== FULL DIFF ==="; git --no-pager diff <from_ref>..<to_ref>
\`\`\`

**PowerShell:**
\`\`\`powershell
'=== COMMITS ==='; git --no-pager log --oneline <from_ref>..<to_ref>; '=== CHANGED FILES ==='; git diff <from_ref>..<to_ref> --name-only; '=== FULL DIFF ==='; git --no-pager diff <from_ref>..<to_ref>
\`\`\`

Replace \`<from_ref>\` and \`<to_ref>\` with the appropriate git references (commit hashes, branch names, tags, HEAD~1, etc.).

## 2. Build Context for Better Explanations

Before calling generate_explanation, gather context that will help produce more insightful explanations:

- Read relevant files to understand the codebase structure
- Look at related code that the changes interact with
- Check for tests that might explain the intended behavior
- Review any related documentation or comments
- If needed, view file contents at different versions: \`git --no-pager show <ref>:<file>\`

The more context you have in your conversation history, the better the explanations will be since generate_explanation uses the full conversation context when generating comments.

## 3. Determine Git References

Identify the appropriate git references for the diff:

- **from_ref**: The "before" state (commit hash, branch name, tag, HEAD~1, etc.)
- **to_ref**: The "after" state (optional - defaults to working directory if omitted)

Examples of reference combinations:
- Last commit: from_ref="HEAD~1", to_ref="HEAD"
- Specific commit: from_ref="abc123^", to_ref="abc123"
- Branch comparison: from_ref="main", to_ref="feature-branch"
- Staged changes: from_ref="HEAD" (omit to_ref to compare to working directory with staged changes)
- PR changes: from_ref="main", to_ref="pr-branch-name"

## 4. Call generate_explanation

Use the generate_explanation tool with:
- **title**: A descriptive title for the diff view (e.g., "Changes in commit abc123", "PR #42: Add user authentication")
- **from_ref**: The git reference for the "before" state
- **to_ref**: The git reference for the "after" state (optional)
Below is the user's input describing what changes they want explained. If no input is provided, default to analyzing uncommitted changes in the working directory (may or may not be staged).
</explicit_instructions>\n
`

/**
 * Generates the deep-planning slash command response with model-family-aware variant selection
 * @param focusChainSettings Optional focus chain settings to include in the prompt
 * @param providerInfo Optional API provider info for model family detection
 * @param enableNativeToolCalls Optional flag to determine if native tool calling is enabled
 * @returns The deep-planning prompt string with appropriate variant and focus chain settings applied
 */
export const deepPlanningToolResponse = (
	focusChainSettings?: { enabled: boolean },
	providerInfo?: ApiProviderInfo,
	enableNativeToolCalls?: boolean,
) => {
	return getDeepPlanningPrompt(focusChainSettings, providerInfo, enableNativeToolCalls)
}
