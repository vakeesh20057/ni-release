# Neural Inverse Power Mode — Implementation Plan

## Decision: Fork OpenCode as In-Process Library

One-time code acquisition from `sst/opencode` (MIT license, TypeScript).
Not tracking upstream. Evolving independently under Neural Inverse branding based on our own user data.

### Why OpenCode as starting point
- 117k stars, battle-tested agent loop and tool implementations
- TypeScript 53% — same stack as Void
- MIT license — commercially clean
- Two built-in agents (build + plan) — maps to regulated environments
- Multi-session support already implemented
- LSP-aware codebase understanding

### Embedding Strategy: In-Process Library (Option B)

Strip OpenCode down to its core agent loop + tool implementations.
Import directly into the VS Code extension host as a library module — no child process, no HTTP/WS layer.

```
OpenCode fork (stripped)
  - Agent execution loop
  - Tool implementations (file, terminal, git, search, etc.)
  - Session state management
  - Context/prompt construction

Void integration layer
  - VoidProviderAdapter: maps OpenCode's model interface -> ILLMMessageService
  - PowerModeService: DI service wrapping the fork's session API
  - PowerModeUI: ocean blue terminal webview in Agent Manager
```

### What gets stripped from the fork
- TUI client (ink)
- Tauri desktop build
- HTTP/WS server layer
- Provider config system (replaced by ILLMMessageService)
- opencode.json config (replaced by IVoidSettingsService)

### What gets kept
- Core agent loop (plan + build agents)
- All tool implementations
- Session state machine
- Context construction (AGENTS.md, codebase indexing)
- Token counting / context window management

## Coexistence

Power Mode is a separate execution path from the existing WorkflowAgentService / AgenticModeService.
Those stay as-is for structured workflow agents. Power Mode is the free-form "Claude Code" experience.

```
Agent Manager
  [Agents]  [Workflows]  [Power Mode]
                              ^
                              |
                         This is new
```

## LLM Routing

Power Mode uses Void's existing ILLMMessageService.
User's configured provider (Anthropic / OpenAI / Azure / Ollama / etc.) flows through automatically.
No separate API key config needed — BYOLLM works out of the box.

## UI: Ocean Blue Terminal

Rendered in a webview panel inside Agent Manager (Power Mode tab).

```
+-------------------------------------------+
| [Agents]  [Workflows]  [Power Mode]      |
+-------------------------------------------+
|                                           |
|  Sessions        |  Terminal Output       |
|  -----------     |  (ocean blue bg)       |
|  > Session 1     |  (monospace, ANSI)     |
|  > Session 2     |                        |
|                  |  > Reading src/...     |
|  Files Changed   |  > Running tsc...      |
|  -----------     |  > 0 errors            |
|  auth.ts         |  > Writing fix...      |
|  index.ts        |  > Done                |
|                  |                        |
|  Tool Calls      |  [instruction input ]  |
|  -----------     |                        |
|  > read_file     |  [Stop] [New Session]  |
|  > bash          |                        |
+-------------------------------------------+
```

## Build Phases

### Phase 1 — Fork and Strip
- Fork `sst/opencode` into `src/vs/workbench/contrib/powerMode/`
- Remove: TUI, Tauri, HTTP server, WS layer, provider config
- Keep: agent core, tools, session state, context construction
- Rename all package references: opencode -> neural-inverse-power
- Preserve MIT license headers on all forked files
- Verify the stripped core compiles standalone

### Phase 2 — Wire to Void LLM Stack
- Implement VoidProviderAdapter: OpenCode model interface -> ILLMMessageService
- Map model selection to IVoidSettingsService (user's configured provider)
- Implement PowerModeService as DI singleton wrapping session lifecycle
- Register: `createDecorator<IPowerModeService>('powerModeService')`

### Phase 3 — Ocean Blue Terminal UI
- Add [Power Mode] tab to Agent Manager webview
- xterm.js for terminal rendering with ANSI color support
- Ocean blue color scheme (#0a1628 background, #e2e8f0 text, #38bdf8 accents)
- Left sidebar: session list, files changed, tool call log
- Right panel: streaming terminal output
- Bottom: instruction input bar + Stop / New Session controls
- Session persists when panel is closed — status bar shows running state

### Phase 4 — Session Management
- Multi-session support: run parallel agent sessions
- Session persistence across IDE restarts (IStorageService)
- Session history browser
- Reconnect to running session when re-opening panel

### Phase 5 — Context Injection (Neural Inverse Aware)
- Auto-generate AGENTS.md equivalent with:
  - Active compliance frameworks from neuralInverseChecks
  - Blocked patterns / restricted APIs
  - Workspace structure summary
- Feed into agent system prompt
- Regenerate on framework changes

### Phase 6 — GRC Gates (Deferred — Separate Track)
- Tool execution interception
- Approval flow for destructive operations
- Audit trail
- Will be planned and built as its own dedicated effort

## Key Files

| Purpose | Path |
|---------|------|
| Power Mode core | `contrib/powerMode/` (forked from OpenCode) |
| DI service | `contrib/powerMode/browser/powerModeService.ts` |
| Provider adapter | `contrib/powerMode/browser/voidProviderAdapter.ts` |
| Terminal UI | `contrib/powerMode/browser/powerModePanel.ts` |
| Agent Manager tab | `contrib/neuralInverse/browser/agentManagerPart.ts` (modified) |
| Existing LLM stack | `contrib/void/common/sendLLMMessageService.ts` |
| Existing settings | `contrib/void/common/voidSettingsService.ts` |
