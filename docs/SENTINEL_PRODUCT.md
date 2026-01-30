# Sentinel QA

> **AI-Powered QA Agent for Automated End-to-End Testing**

## The Problem

AI writes code faster than humans can test it. Copilot, Cursor, Claude - they generate thousands of lines daily. But AI cannot verify if its code actually works. It doesn't see the UI. It doesn't click buttons. It doesn't know if the login form submits correctly.

**Result**: Code velocity increases 10x. Testing stays at 1x. QA becomes the bottleneck.

## The Solution

Sentinel is an AI agent that tests code using real browser automation. It reads your code, understands requirements, opens a browser, and tests like a real user - clicking, typing, and capturing evidence.

**AI writes code. Sentinel verifies it works.**

---

## Key Features

### 1. Smart Test Source Detection

| Mode | How It Works |
|------|--------------|
| **Uncommitted** | Tests local changes via `git diff` |
| **Pull Request** | Checks out PR branch, tests the diff |
| **Files** | Tests specific files you select |

### 2. Automated Test Planning

Sentinel analyzes code and generates test plans covering:
- Functional tests (happy path)
- Edge cases (boundary conditions)
- Error handling (failure scenarios)
- UI verification (visual checks)

### 3. Real Browser Testing

Not mocking. Not simulation. Sentinel opens Chrome, types into forms, clicks buttons, and captures screenshots. Tests the app exactly as users experience it.

### 4. Evidence-Based Reports

Every test produces:
- Screenshots at each step
- Console log captures
- Structured JSON report
- Merge verdict: `MERGEABLE` / `NOT_MERGEABLE` / `MERGEABLE_WITH_RISKS`

### 5. Automatic Bug Fixing

When tests fail, Sentinel offers to fix the code, then re-runs verification.

---

## How It Works

```
Phase 0: DETECT
├── Read uncommitted changes / PR diff / selected files
└── Identify test targets

Phase 1: PLAN
├── Analyze code and requirements
└── Generate test plan with Mermaid diagram

Phase 2: INJECT LOGS
└── Add temporary markers for evidence capture

Phase 3: BUILD & RUN
├── Install dependencies
└── Start dev server

Phase 4: BROWSER TEST
├── Launch real browser
├── Execute test scenarios
├── Capture screenshots and logs
└── Record results

Phase 5: REPORT
├── Remove injected logs
├── Generate verdict
└── Output structured report

Phase 6: FIX (if tests fail)
├── Offer to fix issues
├── Implement patches
└── Re-verify
```

---

## Usage

**Option 1: UI**
1. Open Sentinel panel
2. Select source (Uncommitted / PR / Files)
3. Enter feature description
4. Click "Start QA Test"

**Option 2: Command**
```
/sentinel-qa @src/Login.tsx PRD: User login with email and password
```

---

## Report Output

```json
{
  "summary": {
    "total_tests": 6,
    "passed": 5,
    "failed": 1,
    "verdict": "NOT_MERGEABLE"
  },
  "tests": [
    {
      "id": "TC001",
      "name": "Login Success",
      "status": "passed",
      "evidence": {
        "screenshots": ["login_success.png"],
        "logs": ["User authenticated"]
      }
    }
  ],
  "risks": ["Error message not displayed on failure"],
  "recommendations": ["Add validation feedback"]
}
```

---

## Requirements

- VS Code with Cline extension
- Browser Tool enabled in settings
- Vision-capable model (Claude, GPT-4V)

---

## Architecture

| Component | Purpose |
|-----------|---------|
| `SentinelWelcome.tsx` | UI panel |
| `commands.ts` | QA workflow prompt |
| `SentinelQAReportHandler.ts` | Report generation |
| `browser_action` | Browser automation |

---

## Why Sentinel?

| | Manual QA | Selenium | Sentinel |
|---|-----------|----------|----------|
| Setup | None | Hours | None |
| Adapts to UI changes | Yes | No | Yes |
| Understands intent | Yes | No | Yes |
| Auto-fix bugs | No | No | Yes |

---

*Sentinel - AI that tests AI.*
