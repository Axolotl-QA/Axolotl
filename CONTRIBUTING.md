# Contributing to Axolotl

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/Axolotl-QA/Axolotl.git
cd Axolotl
npm install
npm run build:webview
npm run dev
```

Press **F5** in VS Code to launch the Extension Development Host.

### Key Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Watch mode — rebuilds extension on file changes |
| `npm run build:webview` | Build the webview UI (run after changing `webview-ui/`) |
| `npm run protos` | Regenerate protobuf files (run after changing `proto/`) |
| `npm run test:unit` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run test:e2e` | Run end-to-end tests |

### Important Notes

- `npm run dev` watches the extension code but **does not** watch the webview. Run `npm run build:webview` separately after webview changes.
- Proto files are generated during `npm run dev` (via `npm run protos`). If you see "Cannot read file" errors from esbuild, stop the dev server, run `npm run protos`, then restart.

## Project Structure

```
src/                          Extension source code
├── core/
│   ├── prompts/              System prompts & tool definitions
│   │   └── system-prompt/
│   │       ├── components/   Prompt sections (axolotl_qa_workflow.ts)
│   │       └── tools/        Tool specs (axolotl_*.ts)
│   ├── task/
│   │   └── tools/handlers/   Tool execution handlers (Axolotl*Handler.ts)
│   └── ignore/               .axolotlignore support
├── services/                 Auth, telemetry, MCP
└── integrations/             Browser, checkpoints, terminals

webview-ui/                   React-based sidebar UI
server/                       Fastify auth backend
static_site/                  Login & signup pages
proto/                        Protobuf definitions
```

## How to Contribute

### Bug Reports

Open an [issue](https://github.com/Axolotl-QA/Axolotl/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- VS Code / Cursor version and OS

### Feature Requests

Open an issue describing the use case, not just the solution. We want to understand the problem you're solving.

### Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run test:unit` to verify
4. Open a PR with a clear description of what changed and why

Keep PRs focused — one feature or fix per PR. If your change touches the QA workflow, include a short video or screenshot showing the behavior.

## Code Style

- The project uses [Biome](https://biomejs.dev/) for formatting and linting
- Pre-commit hooks run automatically via Husky
- TypeScript strict mode is enabled

## Axolotl QA Workflow

If you're modifying the QA workflow, here's the architecture:

- **Prompt layer** (`axolotl_qa_workflow.ts`) — defines the 9-phase workflow as natural language instructions
- **Tool specs** (`src/core/prompts/system-prompt/tools/axolotl_*.ts`) — define what parameters each tool accepts
- **Handlers** (`src/core/task/tools/handlers/Axolotl*Handler.ts`) — execute the actual logic and return results that guide the AI to the next step
- **User checkpoints** — `callbacks.ask()` calls in handlers pause execution for user approval

Each handler's return message explicitly tells the AI what to do next. This is what makes the workflow stable.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
