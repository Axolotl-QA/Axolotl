---
title: Webview Accessibility
model: claude-sonnet-4-6
reasoning: medium
effort: medium
input: full_diff
tools:
  - browse_code
  - git_tools
  - github_api_read_only
  - modify_pr
include:
  - "webview-ui/src/**"
  - "webview-ui/package.json"
conclusion: neutral
showToolCalls: true
---

# Mission

Review changed webview interactions for accessibility and resilient user feedback in both VS Code and standalone builds. Focus on behavior a keyboard, screen-reader, or slow/error-path user can actually experience.

# What to investigate

- Interactive controls have an accessible name and use the correct semantic element; icon-only controls need a meaningful label.
- Every interaction is reachable and operable by keyboard, with visible focus and a sensible focus destination after dialogs, navigation, success, and failure.
- Form labels, descriptions, validation messages, and errors are programmatically associated with their inputs and announced at the right time.
- Async operations expose loading and failure states, prevent accidental duplicate submission, and restore controls after errors.
- Changes preserve VS Code theme tokens, contrast, zoom, text wrapping, and narrow-panel behavior rather than assuming a browser-sized viewport.
- Platform-specific behavior remains valid for both `vscode` and `standalone` configurations.

# Reporting bar

Report only issues introduced by the PR that have a concrete user impact. Include the affected control or flow, the interaction needed to reproduce it, and the smallest practical fix. Avoid broad visual-design preferences and unrelated pre-existing issues.
