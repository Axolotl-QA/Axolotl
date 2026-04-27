<p align="center">
  <img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/icons/icon.png" width="140" alt="Axolotl" />
</p>

<h1 align="center">Axolotl</h1>

<p align="center">
  <strong>AI that tests your code before you merge it.</strong>
</p>

<p align="center">
  Point it at a PR. It reads the diff, analyzes the code, generates tests,<br/>
  opens a real browser, clicks through your app, and tells you if it's safe to ship.
</p>

<p align="center">
  <a href="https://qaxolotl.com"><img src="https://img.shields.io/badge/Website-qaxolotl.com-8A2BE2?style=for-the-badge" alt="Website"></a>&nbsp;
  <a href="https://github.com/Axolotl-QA/Axolotl/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge" alt="License"></a>&nbsp;
  <a href="https://github.com/Axolotl-QA/Axolotl/stargazers"><img src="https://img.shields.io/github/stars/Axolotl-QA/Axolotl?style=for-the-badge&color=yellow" alt="Stars"></a>
</p>

<br/>

<p align="center">
  <img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/07-e2e.gif" width="720" alt="Axolotl running end-to-end browser tests" />
</p>
<p align="center"><em>Axolotl testing a live app — clicking buttons, checking responses, capturing evidence.</em></p>

<br/>

---

<br/>

## The Problem

You open a PR. You eyeball the diff. You run the existing test suite — it passes. You merge.

Two hours later, production breaks. The tests didn't cover the actual user flow that changed.

**Axolotl fixes this.** It reads your code changes, figures out what *should* be tested, and actually tests it — in a real browser, against your real app.

<br/>

---

<br/>

## See Every Step

<table><tr>
<td width="35%" valign="top">

### 1. Sign In

One-click Google sign in. Only used for future update notifications — **no usage data is collected**.

[Watch full video &rarr;](https://youtu.be/OxcI_s_Q4OI)

</td>
<td width="65%">

<img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/01-signin.gif" alt="Sign In" />

</td>
</tr></table>

<table><tr>
<td width="65%">

<img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/02-settings.gif" alt="Configure Settings" />

</td>
<td width="35%" valign="top">

### 2. Configure

Set your **Anthropic API key** and [You.com API key](https://api.you.com/) for web search. We recommend **Claude Sonnet 4.6 (1M)** — all browser testing is optimized for Sonnet.

[Watch full video &rarr;](https://youtu.be/_QrNSwnoKzw)

</td>
</tr></table>

<table><tr>
<td width="35%" valign="top">

### 3. Start a QA Session

Pick your source: a PR number, uncommitted changes, or specific files. Or just type in the chat box.

[Watch full video &rarr;](https://youtu.be/Gf--pxAJEIk)

</td>
<td width="65%">

<img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/03-start.gif" alt="Start QA Session" />

</td>
</tr></table>

<table><tr>
<td width="65%">

<img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/04-code-analysis.gif" alt="Code Analysis" />

</td>
<td width="35%" valign="top">

### 4. Code Analysis

Tree-sitter AST parsing + ripgrep pattern search. Axolotl understands your code structure before writing any tests.

[Watch full video &rarr;](https://youtu.be/dbvSSG2ABDw)

</td>
</tr></table>

<table><tr>
<td width="35%" valign="top">

### 5. Web Search & Test Cases

Searches for testing best practices specific to your tech stack, then generates targeted test cases.

[Watch full video &rarr;](https://youtu.be/VbObxj5kdeY)

</td>
<td width="65%">

<img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/05-web-search.gif" alt="Web Search & Test Cases" />

</td>
</tr></table>

### 6. Local CI Verification &nbsp;<sup>NEW</sup>

Before generating any test case, Axolotl runs your project's real `lint` / `typecheck` / `test` scripts on the changed files, parses structured `file:line:rule` failures, and forwards them as first-class context into the test planner. The generated plan markdown persists a `## CI Verification Results` section so reviewers see exactly which real CI failures triggered which test cases — no more hallucinated bugs for problems you don't have. Auto-skipped when the project has no CI configured. Toggle in **Settings → Features → Run Local CI before Test Plan** (on by default).

<br/>

<table><tr>
<td width="65%">

<img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/06-plan.gif" alt="Plan & Log Injection" />

</td>
<td width="35%" valign="top">

### 7. Plan & Log Injection

Review the test plan. On approval, Axolotl injects temporary log markers to capture behavioral evidence.

[Watch full video &rarr;](https://youtu.be/zK9ZrAGQGks)

</td>
</tr></table>

<table><tr>
<td width="35%" valign="top">

### 8. End-to-End Testing

Real browser. Real clicks. Real screenshots. Monitors frontend UI and backend output simultaneously.

[Watch full video &rarr;](https://youtu.be/osxX891zBEM)

</td>
<td width="65%">

<img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/07-e2e.gif" alt="End-to-End Testing" />

</td>
</tr></table>

<table><tr>
<td width="65%">

<img src="https://raw.githubusercontent.com/Axolotl-QA/Axolotl/main/assets/gifs/08-report.gif" alt="Report & Memory" />

</td>
<td width="35%" valign="top">

### 9. Report & Memory

Evidence-backed verdict with pass/fail per test case. Axolotl remembers your project setup for next time.

[Watch full video &rarr;](https://youtu.be/rq-h5USFsMA)

</td>
</tr></table>

### 10. Fix in Axolotl or Hand Off &nbsp;<sup>NEW</sup>

When the QA report surfaces failures, two buttons appear at the bottom of the report card:

- **🔧 Fix in Axolotl** — continues the same agent into Phase 8 to fix the underlying bugs in place, then re-runs CI to verify.
- **📋 Copy fix prompt** — writes a self-contained Markdown to your clipboard: verdict, every failed test with logs and evidence, risks, recommendations, on-disk artifact paths, explicit fix instructions. Paste it into Claude Code, Cursor, Codex CLI, or any agent that reads Markdown.

Most QA tools want to own the fix loop too. Axolotl doesn't — your existing coding agent gets the full context, every time.

<br/>

---

<br/>

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Axolotl-QA/Axolotl.git
cd Axolotl
npm install
npm run build:webview
npm run dev
```

Press **F5** to launch the Extension Development Host.

### 2. Configure

| Setting | Value | Why |
|---------|-------|-----|
| **Model** | Claude Sonnet 4.6 (1M) or Opus 4.6 | All browser testing is optimized for Sonnet. Other models produce inconsistent results. |
| **Provider** | [Anthropic](https://console.anthropic.com/) | Direct API access, best performance. |
| **Web Search** | [You.com API key](https://api.you.com/) | Enables research on testing best practices. Significantly improves test plan quality. |

### 3. Run

```
--source=pr --pr=123              ← test a pull request
--source=uncommitted              ← test your working changes
--source=files @src/auth.ts       ← test specific files
```

Or just describe what you want tested in the chat box.

<br/>

---

<br/>

## Why Axolotl

| | Traditional Testing | Axolotl |
|---|---|---|
| **Test creation** | You write and maintain test scripts | AI generates tests from code analysis |
| **Coverage gaps** | Tests cover what you thought to test | Tests cover what actually changed |
| **Grounding** | Tests written from imagined bugs | Tests grounded in your project's actual lint/typecheck/test failures |
| **Browser testing** | Selenium/Playwright setup required | Built-in browser with screenshot evidence |
| **Maintenance** | Tests break when UI changes | Fresh tests every run, zero maintenance |
| **Evidence** | Pass/fail boolean | Screenshots, logs, behavioral markers |
| **Fix delegation** | Locked into one tool's chat to repair | One-click hand-off to your existing coding agent (Claude Code, Cursor, Codex) |
| **Time to first test** | Hours to days | Minutes |

<br/>

---

<br/>

## Key Features

**Zero test maintenance** — tests are generated on-the-fly from your actual code changes. No test suite to maintain.

**Real CI grounding** — runs your project's `lint` / `typecheck` / `test` scripts before planning, so generated tests target real failures instead of hallucinated ones. The plan markdown shows exactly which CI failure triggered which test case.

**Evidence-driven verdicts** — every result is backed by screenshots, console logs, and injected behavioral markers. Not just pass/fail.

**Multi-agent fix handoff** — one click writes a complete fix prompt to your clipboard for Claude Code, Cursor, Codex CLI, or any agent that reads Markdown. No vendor lock-in at the moment of repair. Or click "Fix in Axolotl" to repair in place.

**Human-in-the-loop** — you review the test plan, approve each phase, and decide what to do with the results.

**Persistent memory** — Axolotl remembers how to install deps, start your dev server, and run your app across sessions via `axolotl.md`.

**Web-informed** — searches the internet for testing best practices relevant to your specific tech stack before generating test cases.

**Multi-language analysis** — tree-sitter powered AST parsing for JavaScript, TypeScript, Python, Rust, Go, C/C++, C#, Ruby, Java, PHP, Swift, and Kotlin.

<br/>

---

<br/>

## Contributing

We'd love your help. See the [Contributing Guide](CONTRIBUTING.md) for details.

```bash
git clone https://github.com/Axolotl-QA/Axolotl.git
cd Axolotl
npm install
npm run dev            # watch mode
npm run build:webview  # build UI
# F5 to launch
```

<br/>

---

<br/>

## Star History

<a href="https://www.star-history.com/?repos=Axolotl-QA%2FAxolotl&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Axolotl-QA/Axolotl&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Axolotl-QA/Axolotl&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Axolotl-QA/Axolotl&type=date&legend=top-left" />
 </picture>
</a>

<br/>

---

<br/>

## License

Apache 2.0 — see [LICENSE](LICENSE).

Built on [Cline](https://github.com/cline/cline). Extended for automated QA.
