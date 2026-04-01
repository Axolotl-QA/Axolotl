<p align="center">
  <img src="assets/icons/icon.png" width="140" alt="Axolotl" />
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
  <img src="assets/gifs/06-e2e.gif" width="720" alt="Axolotl running end-to-end browser tests" />
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

<table>
<tr>
<td width="50%">

### 1. Sign In
One-click Google sign in. Only used for future update notifications — **no usage data is collected**.

</td>
<td width="50%">

### 2. Start a QA Session
Pick your source: a PR number, uncommitted changes, or specific files. Or just type in the chat.

</td>
</tr>
<tr>
<td>

<a href="https://youtu.be/OxcI_s_Q4OI"><img src="assets/gifs/01-signin.gif" alt="Sign In" /></a>

</td>
<td>

<a href="https://youtu.be/Gf--pxAJEIk"><img src="assets/gifs/02-start.gif" alt="Start QA Session" /></a>

</td>
</tr>
</table>

<table>
<tr>
<td width="50%">

### 3. Code Analysis
Tree-sitter AST parsing + ripgrep pattern search. Axolotl understands your code structure before writing any tests.

</td>
<td width="50%">

### 4. Web Search & Test Cases
Searches for testing best practices specific to your tech stack, then generates targeted test cases.

</td>
</tr>
<tr>
<td>

<a href="https://youtu.be/dbvSSG2ABDw"><img src="assets/gifs/03-code-analysis.gif" alt="Code Analysis" /></a>

</td>
<td>

<a href="https://youtu.be/VbObxj5kdeY"><img src="assets/gifs/04-web-search.gif" alt="Web Search & Test Cases" /></a>

</td>
</tr>
</table>

<table>
<tr>
<td width="50%">

### 5. Plan & Log Injection
Review the test plan. On approval, Axolotl injects temporary log markers to capture behavioral evidence.

</td>
<td width="50%">

### 6. End-to-End Testing
Real browser. Real clicks. Real screenshots. Monitors frontend UI and backend output simultaneously.

</td>
</tr>
<tr>
<td>

<a href="https://youtu.be/zK9ZrAGQGks"><img src="assets/gifs/05-plan.gif" alt="Plan & Log Injection" /></a>

</td>
<td>

<a href="https://youtu.be/osxX891zBEM"><img src="assets/gifs/06-e2e.gif" alt="End-to-End Testing" /></a>

</td>
</tr>
</table>

<table>
<tr>
<td width="50%">

### 7. Report & Memory
Evidence-backed verdict with pass/fail per test case. Axolotl remembers your project setup for next time.

</td>
<td width="50%">

### 8. Configure Settings
Set your Anthropic API key and You.com API key. We recommend **Claude Sonnet 4.6 (1M)** for all workflows.

</td>
</tr>
<tr>
<td>

<a href="https://youtu.be/rq-h5USFsMA"><img src="assets/gifs/07-report.gif" alt="Report & Memory" /></a>

</td>
<td>

<a href="https://youtu.be/_QrNSwnoKzw"><img src="https://img.youtube.com/vi/_QrNSwnoKzw/hqdefault.jpg" width="100%" alt="Settings" /></a>

</td>
</tr>
</table>

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
| **Browser testing** | Selenium/Playwright setup required | Built-in browser with screenshot evidence |
| **Maintenance** | Tests break when UI changes | Fresh tests every run, zero maintenance |
| **Evidence** | Pass/fail boolean | Screenshots, logs, behavioral markers |
| **Time to first test** | Hours to days | Minutes |

<br/>

---

<br/>

## Key Features

**Zero test maintenance** — tests are generated on-the-fly from your actual code changes. No test suite to maintain.

**Evidence-driven verdicts** — every result is backed by screenshots, console logs, and injected behavioral markers. Not just pass/fail.

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

## License

Apache 2.0 — see [LICENSE](LICENSE).

Built on [Cline](https://github.com/cline/cline). Extended for automated QA.
