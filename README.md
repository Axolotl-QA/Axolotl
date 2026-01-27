# Sentinel

<p align="center">
  <img src="./assets/docs/sentinel-banner.png" width="100%" alt="Sentinel - AI QA Agent for VS Code" />
</p>

**Sentinel is an AI-powered QA Agent that lives in your VS Code workspace.**

Unlike traditional testing frameworks, Sentinel acts as your automated QA engineer during the PR review phase. It doesn't aim for 100% test coverage—instead, it focuses on **evidence-driven validation** of main flows to help you decide: **"Is this PR functional?"**

## 🎯 Product Positioning

- **PR-centric workflow**: Each QA session is tied to a specific Pull Request
- **Evidence-based decisions**: Uses real system execution + UI behavior + logs to make judgments
- **Main flow focused**: Validates critical paths, not exhaustive edge cases
- **Merge confidence**: Final output is a clear recommendation on merge safety

> **Sentinel ≠ Test Framework**
> **Sentinel ≠ CI/CD Pipeline**
> **Sentinel = Your QA teammate during PR review**

---

## 🏗️ Architecture Overview

```
┌─────────────────────────┐
│ VS Code Extension (UI)  │
│  - Side Panel           │
│  - Commands             │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Sentinel Orchestrator   │  ← Core Intelligence
│  - State Machine / DAG  │
│  - QA Rules Engine      │
│  - Evidence Aggregation │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ Execution Engine        │
│  - Write/modify code    │
│  - Execute commands     │
│  - Interact with UI     │
│  - Capture evidence     │
└─────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- VS Code 1.93 or higher
- Node.js 18.x or higher
- Git repository with a PR or changes to test

### Installation

#### Option 1: Install from Source (Development)

```bash
# Clone the repository
git clone https://github.com/yourusername/sentinel.git
cd sentinel

# Install dependencies
npm run install:all

# Build the extension
npm run compile

# Run in development mode
npm run dev
```

Then press `F5` in VS Code to launch the Extension Development Host.

#### Option 2: Package and Install

```bash
# Package the extension
npm run package

# This creates a .vsix file that you can install:
# VS Code → Extensions → ... menu → Install from VSIX
```

### First Run

1. Open VS Code Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
2. Run: `Sentinel: Run QA for this PR`
3. Configure your AI model provider (OpenAI, Anthropic, etc.) when prompted
4. Let Sentinel analyze your changes and generate a test plan

---

## 💡 Core Features

### 1. **Test Context Selection**

Sentinel supports two ways to understand what to test:

**Option A: Current PR (Recommended)**
- Automatically reads `git diff`
- Identifies affected modules (frontend/backend/fullstack)
- Classifies PR type (new feature, bug fix, refactor, etc.)
- Can link to PRD or ticket URLs for additional context

**Option B: Manual Description**
- Paste or type a description of your changes
- Useful for quick ad-hoc testing outside of PR workflow

### 2. **Intelligent Log Injection**

One of Sentinel's key differentiators:

- Automatically identifies critical functions in your main flow
- Injects test-specific logging statements when needed
- Uses logs as **behavioral evidence** during test execution
- Marks injected logs with `// SENTINEL_TEST_LOG` for easy cleanup

Example:
```typescript
console.log("[SENTINEL] submitForm called", payload)
```

**Philosophy**: Success isn't just about UI feedback—it's about proving the right code path executed.

### 3. **Build & Environment Validation**

Before running tests, Sentinel:
- Installs dependencies (`npm install`)
- Starts your dev server (`npm run dev`)
- Validates process health (port listening, HTTP 200 responses)

❌ If build fails → Test session terminates immediately
✅ If build succeeds → Proceeds to test execution

### 4. **Test Plan Generation**

Sentinel creates an executable test plan based on your changes:

```json
[
  {
    "id": "build",
    "type": "system",
    "blocking": true
  },
  {
    "id": "main_flow_submit",
    "type": "e2e",
    "steps": [
      "open /register",
      "fill email field",
      "click submit button"
    ],
    "expected_logs": [
      "[SENTINEL] submitForm called"
    ]
  }
]
```

Each test includes:
- Step-by-step UI actions
- Expected log outputs
- Pass/fail criteria

### 5. **Execution with Evidence Collection**

For each test, Sentinel:
- Launches browser and performs UI interactions
- Monitors terminal output and application logs
- Compares actual logs against expected behavior
- Captures screenshots for visual verification
- Records pass/fail/warning states

**Evidence Types:**
- ✅ UI succeeded + expected logs present = **Pass**
- ⚠️ UI succeeded but unexpected error logs = **Warning**
- ❌ No logs or wrong sequence = **Fail**
- ❌ UI error or crash = **Fail**

### 6. **Merge Decision Report**

Final output: `report.json`

```json
{
  "summary": {
    "build": "pass",
    "main_flow": "pass",
    "edge_cases": "partial",
    "conclusion": "mergeable_with_risk"
  },
  "tests": [
    {
      "id": "main_flow_submit",
      "result": "pass",
      "evidence": {
        "logs": ["[SENTINEL] submitForm called"],
        "ui_actions": ["click submit"],
        "screenshots": ["screenshot-001.png"]
      }
    }
  ],
  "risks": [
    "Empty input validation not tested"
  ]
}
```

This report is:
- Displayed in the Sentinel Side Panel
- Can be posted as PR comment
- Machine-readable for future trend analysis

---

## 🎮 Using Sentinel

### Command Palette Commands

```
Sentinel: Run QA for this PR
Sentinel: Run QA (manual context)
Sentinel: Re-run last QA
Sentinel: Open QA Report
```

### Side Panel Interface

The Sentinel Side Panel is your QA control center:

```
┌──────────────────────────────┐
│ Sentinel QA                  │
├──────────────────────────────┤
│ [1] Test Context             │
│  ○ Current PR: #123          │
│  ○ Manual description        │
│                              │
│ [2] Test Plan (Generated)    │
│  ✔ Build & Start             │
│  ⏳ Main Flow: Create User    │
│  ⏳ Main Flow: Submit Form    │
│  ⏳ Edge: Empty input         │
│                              │
│ [3] Execution Logs           │
│  - Terminal output           │
│  - UI actions                │
│  - Evidence collected        │
│                              │
│ [4] Final Result             │
│  ⚠ Mergeable with risk       │
│  See report.json for details │
└──────────────────────────────┘
```

### Typical Workflow

1. **Create a PR** with your changes
2. **Run Sentinel** via Command Palette
3. **Review generated test plan** in Side Panel
4. **Watch execution** as Sentinel:
   - Injects logs if needed
   - Builds and starts your app
   - Runs UI tests
   - Collects evidence
5. **Review results** and decide whether to merge

You can:
- ⏸️ Pause/resume execution
- 🔄 Retry failed tests
- ⏭️ Skip non-blocking tests
- 📝 Add manual notes to report

---

## 🎯 MVP Scope

### ✅ What's Included

- VS Code Extension with Side Panel UI
- PR context parsing (git diff)
- Manual context input fallback
- Automatic log injection
- Build & environment validation
- Main flow E2E testing
- Evidence-based pass/fail logic
- `report.json` output
- Browser interaction (via Computer Use)
- Terminal command execution

### ❌ What's NOT Included (Yet)

- Automatic bug fixing
- Full edge case coverage
- Cloud-based execution
- Historical learning/ML
- Integration with external CI/CD
- Multi-repository testing
- Performance benchmarking


### Available Scripts

```bash
npm run install:all          # Install all dependencies
npm run dev                  # Development mode with watch
npm run compile              # Type-check + lint + build
npm run test                 # Run all tests
npm run test:unit            # Unit tests only
npm run test:integration     # Integration tests
npm run lint                 # Lint check
npm run package              # Package for production
```

### Debugging

Press `F5` in VS Code to launch the Extension Development Host with debugger attached.

---

## 🤝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 📝 License

[Apache 2.0](./LICENSE)

**Sentinel** is a derivative work based on [Cline](https://github.com/cline/cline), originally developed by Cline Bot Inc.

- Original work: Copyright 2025 Cline Bot Inc.
- Modifications for Sentinel: Copyright 2025 Sentinel Contributors

This project is licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE) for the full license text.

---

## 🙋 FAQ

**Q: Does Sentinel replace my existing test suite?**
A: No. Sentinel is a **PR-stage QA assistant**, not a replacement for unit/integration tests. Use it to validate main flows before merging.

**Q: Can Sentinel fix bugs automatically?**
A: Not in the MVP. Sentinel focuses on **detection and reporting**. Auto-fixing may come in future versions.

**Q: Which AI models does Sentinel support?**
A: Any model compatible with OpenAI API format, including:
- OpenAI (GPT-4, GPT-4 Turbo)
- Anthropic (Claude Sonnet, Opus)
- OpenRouter (access to multiple providers)
- Local models via LM Studio/Ollama

**Q: Can I use Sentinel on private repositories?**
A: Yes. Sentinel runs entirely in your local VS Code environment. Your code never leaves your machine (except API calls to your chosen LLM provider).

**Q: How is this different from Playwright or Cypress?**
A: Traditional frameworks require you to **write** tests. Sentinel **generates and executes** tests based on PR changes, then gives you a merge recommendation.

---

## 🌟 Why Sentinel?

Traditional QA approaches:
- ❌ Manual testing is slow and error-prone
- ❌ Writing tests for every PR takes time
- ❌ CI only catches issues after merge
- ❌ No holistic "should I merge?" answer

**Sentinel approach:**
- ✅ Automatically understands what changed
- ✅ Generates relevant tests on-the-fly
- ✅ Validates before merge, not after
- ✅ Evidence-driven merge decisions

**Sentinel brings QA into your development flow, not as an afterthought.**

