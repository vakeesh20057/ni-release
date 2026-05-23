# Contributing to Neural Inverse OSS

Thank you for your interest in contributing! Neural Inverse is open source and we welcome contributions of all kinds.

## Documentation

Full contributor guides are available at:

- [Getting Started](https://neuralinverse.com/guides/contributing/getting-started) - dev setup and first contribution
- [Architecture](https://neuralinverse.com/guides/contributing/architecture) - module map, DI, how features connect
- [Bring Your Own LLM](https://neuralinverse.com/guides/contributing/byollm) - supported providers, per-feature model selection, adding providers
- [AI Chat & Inline Edit](https://neuralinverse.com/guides/contributing/ai-chat) - sidebar chat, Ctrl+K, autocomplete, Fast Apply
- [Power Mode](https://neuralinverse.com/guides/contributing/power-mode) - autonomous agent, tools, sub-agents, configuration
- [Firmware & Embedded](https://neuralinverse.com/guides/contributing/firmware) - MCU database, SVD, serial monitor, agent tools
- [Legacy Modernisation](https://neuralinverse.com/guides/contributing/modernisation) - 5-stage pipeline, adding languages and profiles
- [Model Management](https://neuralinverse.com/guides/contributing/model-management) - deployment registry, cloud provisioning, agent manager UI

## Ways to contribute

- Report bugs via [GitHub Issues](https://github.com/NeuralInverse/neuralinverse/issues)
- Suggest features or improvements
- Submit pull requests for bug fixes or new features
- Improve documentation
- Add new LLM provider integrations
- Add new language support to the modernisation engine
- Add new MCU/platform support to the firmware module

## Getting started

1. Fork the repo and clone it locally
2. Install dependencies: `npm install`
3. Start dev mode:
   - Terminal 1: `npm run watch`
   - Terminal 2: `npm run watchreact`
   - Terminal 3: `./scripts/code.sh` (macOS/Linux) or `.\scripts\code.bat` (Windows)
4. Make your changes on a new branch
5. Verify the build: `npm run compile`
6. Open a pull request against `main`

See [HOW_TO_CONTRIBUTE.md](./HOW_TO_CONTRIBUTE.md) for full platform-specific setup instructions.

## Project structure

All Neural Inverse code lives under `src/vs/workbench/contrib/`:

| Module | Path | What it does |
|--------|------|--------------|
| AI Chat & Core | `contrib/void/` | Sidebar chat (Ctrl+L), inline edit (Ctrl+K), autocomplete, LLM routing, settings |
| Power Mode | `contrib/powerMode/` | Autonomous agent with tool calling (Cmd+Alt+P) |
| Agent Manager | `contrib/neuralInverse/` | Model management, deployments, agent orchestration (Cmd+Alt+A) |
| Firmware | `contrib/neuralInverseFirmware/` | MCU database, SVD register maps, serial monitor, fw_* tools (Cmd+Alt+F) |
| Modernisation | `contrib/neuralInverseModernisation/` | 5-stage legacy migration engine (Cmd+Alt+M) |

Each module has a `.contribution.ts` file that registers all its services.

## Pull request guidelines

- Keep PRs focused - one feature or fix per PR
- Write a clear description of what changed and why
- Make sure `npm run compile` passes with zero errors
- No non-ASCII characters in TypeScript/JavaScript string literals (breaks the release build)
- Fill out the PR template (area, testing, checklist)

## Key rules

- **ASCII only** in TS/JS string literals. Use unicode escapes (`–`) if non-ASCII is semantically required.
- **No `any` casts.** Find and use the correct type.
- **No changes outside `src/vs/workbench/contrib/`** without discussion first.
- **Follow existing conventions** per file (semicolons, formatting).

## Scope of contributions

Contributions to the following are welcome:

- AI chat and agentic workflows (`contrib/void/`, `contrib/powerMode/`)
- Agent manager and model management (`contrib/neuralInverse/`)
- Modernisation engine (`contrib/neuralInverseModernisation/`)
- Firmware tooling (`contrib/neuralInverseFirmware/`)
- General IDE improvements

Enterprise features (Checks, GRC, compliance engine, auth) are not part of this repo.

## Adding a new LLM provider

1. Add provider name to `ProviderName` in `contrib/void/common/voidSettingsTypes.ts`
2. Implement SDK call in `contrib/void/electron-main/llmMessage/sendLLMMessage.impl.ts`
3. Add default models to `contrib/void/common/modelCapabilities.ts`
4. Settings UI auto-generates from the schema - just add the entry

## Adding a language to modernisation

1. `discovery/languageDetector.ts` - file extensions + heuristics
2. `discovery/unitDecomposer.ts` - how to split into migration units
3. `discovery/dependencyExtractor.ts` - import/include patterns
4. `discovery/fileWalker.ts` - add to SOURCE_EXTS
5. `discovery/complexityAnalyzer.ts` - cyclomatic complexity patterns
6. `translation/impl/languagePairRegistry.ts` - add translation profile with idiom mappings

## Adding MCU support to firmware

1. Add MCU variants to `neuralInverseFirmware/common/mcuDatabase.ts`
2. Add SVD file URL to the SVD registry
3. Add platform knowledge pack if needed (clock trees, DMA, ISR patterns)

## AI-assisted contributions (BYOLLM)

Neural Inverse is a BYOLLM platform. If you used AI assistance, include TWO `Co-authored-by` trailers:

1. **Always include the NeuralInverse platform trailer:**
```
Co-authored-by: neuralinverse-dev <noreply@neuralinverse.com>
```

2. **Plus the specific LLM you used:**

| Model | Trailer |
|---|---|
| Claude (Anthropic) | `Co-authored-by: Claude <noreply@anthropic.com>` |
| ChatGPT / GPT-4 (OpenAI) | `Co-authored-by: ChatGPT <noreply@openai.com>` |
| Gemini (Google) | `Co-authored-by: Gemini <noreply@google.com>` |
| Custom / self-hosted | `Co-authored-by: [Model Name] <your-contact-email>` |

Example:
```
fix: resolve null pointer in session service

Co-authored-by: neuralinverse-dev <noreply@neuralinverse.com>
Co-authored-by: Claude <noreply@anthropic.com>
```

## Questions?

Open an issue or email github@neuralinverse.com.
