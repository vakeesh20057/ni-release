# Neural Inverse GRC Tools Integration

## Overview

This document describes the design and implementation of GRC (Governance, Risk, Compliance) tooling integration for both the **void coding agent** and **Power Mode** agents inside the Neural Inverse IDE.

The goal: coding agents can access live compliance data directly as tools, and can delegate deep compliance analysis to the dedicated Checks Agent via an `ask_checksagent` tool — keeping coding agents focused on code while GRC expertise stays in the Checks Agent.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Neural Inverse IDE                         │
│                                                                 │
│  ┌─────────────────┐   PowerBus   ┌──────────────────────────┐ │
│  │   Power Mode    │◄────────────►│     Checks Agent         │ │
│  │  (coding AI)    │              │   (GRC specialist AI)    │ │
│  │                 │              │                          │ │
│  │  GRC tools:     │              │  answerQuery() API       │ │
│  │  • grc_violations              │  • runChecksAgentLoop    │ │
│  │  • grc_domain_summary          │    (silent, no UI)       │ │
│  │  • grc_blocking_violations     │                          │ │
│  │  • grc_framework_rules         └──────────────────────────┘ │
│  │  • grc_impact_chain             ▲                           │
│  │  • ask_checksagent──────────────┘                           │
│  └─────────────────┘                                           │
│                                                                 │
│  ┌─────────────────┐                                           │
│  │  Void Chat AI   │   Direct DI injection                     │
│  │  (agent/copilot │◄──────────────────────────────────────┐  │
│  │   /validate)    │         IChecksAgentService            │  │
│  │                 │         IGRCEngineService              │  │
│  │  Power Mode tools: bash, read, write, edit,              │  │
│  │                    glob, grep, list                      │  │
│  │  GRC tools:     │                                        │  │
│  │  • grc_violations                                        │  │
│  │  • grc_domain_summary                                    │  │
│  │  • grc_blocking_violations                               │  │
│  │  • grc_framework_rules                                   │  │
│  │  • grc_impact_chain                                      │  │
│  │  • ask_checksagent                                       │  │
│  └─────────────────┘                                        │  │
│                           ┌─────────────────────────────────┘  │
│                           │                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              GRC Engine (IGRCEngineService)              │   │
│  │  getAllResults() • getDomainSummary() • getBlockingViol. │   │
│  │  getRules() • getImpactChain() • getActiveFrameworks()   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. `checksAgentService.ts` — `answerQuery(question)`

Added to `IChecksAgentService` interface and implementation.

- Runs a silent `runChecksAgentLoop` with the question as a user message
- No UI events fired (no streaming to webview)
- 30s timeout via AbortController
- Returns the collected text response from the assistant message parts
- Used by both Power Mode's `ask_checksagent` tool (via PowerBus) and void's toolsService (via direct DI)

`_handleBusQuery` is updated to:
- Fast path: if `content === 'posture-summary'` → return JSON posture summary (existing behavior, no LLM round-trip)
- LLM path: else → call `answerQuery(content)` → reply with the natural-language answer

### 2. `powerMode/browser/tools/grcTools.ts` — NEW FILE

Six tools registered in Power Mode's tool registry:

| Tool | Parameters | Source |
|------|-----------|--------|
| `grc_violations` | domain?, severity?, file?, limit? | `IGRCEngineService.getAllResults()` |
| `grc_domain_summary` | — | `IGRCEngineService.getDomainSummary()` |
| `grc_blocking_violations` | — | `IGRCEngineService.getBlockingViolations()` |
| `grc_framework_rules` | frameworkId? | `IGRCEngineService.getRules()` + `getActiveFrameworks()` |
| `grc_impact_chain` | file (path) | `IGRCEngineService.getImpactChain()` |
| `ask_checksagent` | question | PowerBus → `checksAgentService.answerQuery()` |

### 3. `powerModeService.ts` — updates

- Injects `@IGRCEngineService`
- Adds `_pendingChecksAgentQueries` map (separate from `_pendingGRCQueries` to avoid polluting posture cache)
- Adds `_queryChecksAgent(question)` method — sends a `query` bus message to Checks Agent and routes the response back (30s timeout)
- Bus handler updated to check `_pendingChecksAgentQueries` when routing Checks Agent responses
- `_getToolRegistry` updated to include the 6 GRC tools

### 4. `powerMode/browser/session/systemPrompt.ts` — updates

`POWER_BUS_BLOCK` extended to document:
- The 5 direct GRC data tools (no round-trip, use when you need raw data fast)
- The `ask_checksagent` tool (use when you need reasoning, interpretation, or deeper analysis)

### 5. `void/common/toolsServiceTypes.ts` — updates

Added 6 entries to `BuiltinToolCallParams` and `BuiltinToolResultType`:
- `grc_violations`, `grc_domain_summary`, `grc_blocking_violations`, `grc_framework_rules`, `grc_impact_chain`, `ask_checksagent`

### 6. `void/browser/toolsService.ts` — updates

- Injects `@IGRCEngineService` and `@IChecksAgentService`
- Implements `validateParams`, `callTool`, `stringOfResult` for the 6 new tools
- `ask_checksagent` calls `checksAgentService.answerQuery()` directly (no PowerBus needed — toolsService has direct DI access)

### 7. `void/common/prompt/prompts.ts` — updates

Added 6 entries to the `builtinTools` object (satisfies `{ [T in keyof BuiltinToolResultType]: InternalToolInfo }`).

GRC tools are available in all chat modes that already include builtins: `agent`, `copilot`, `validate`, `ask`, `reason`, `gather`. Not in `power` or `checks` (those manage their own tools).

---

## Data Flow

### Direct data tools (fast path)

```
Coding Agent → grc_violations → toolsService.callTool()
                              → IGRCEngineService.getAllResults()
                              → returns formatted violation list
```

### ask_checksagent (void coding agent)

```
Coding Agent → ask_checksagent("does this file violate SOC2?")
             → toolsService.callTool()
             → IChecksAgentService.answerQuery()
             → runChecksAgentLoop() [silent, 30s timeout]
             → Checks Agent LLM with all GRC tools available
             → returns natural-language answer
```

### ask_checksagent (Power Mode)

```
Power Mode → ask_checksagent tool → _queryChecksAgent()
           → PowerBus.send('power-mode', 'checks-agent', 'query', question)
           → checksAgentService._handleBusQuery() [LLM path]
           → checksAgentService.answerQuery()
           → runChecksAgentLoop() [silent, 30s timeout]
           → PowerBus.send('checks-agent', 'power-mode', 'response', answer)
           → _pendingChecksAgentQueries resolver fires
           → Power Mode gets answer
```

---

## Why Separate `ask_checksagent` from `_pendingGRCQueries`

`_pendingGRCQueries` caches posture summaries — these are JSON blobs consumed by the system prompt. If a natural-language Checks Agent answer got cached as `_lastKnownGRCPosture`, the next task would have a paragraph of prose injected into `<grc_posture>` instead of structured JSON.

`_pendingChecksAgentQueries` is a separate map that routes LLM answers back to the tool caller without touching the posture cache.

---

## Tool Descriptions for AI

### grc_violations
Returns current GRC violations with optional filters. Use when you need to see what rules are being violated before making changes.

### grc_domain_summary
Returns per-domain violation counts (security, privacy, data-integrity, etc.). Use for a high-level compliance overview.

### grc_blocking_violations
Returns only violations that would block a commit. Always check this before preparing a commit.

### grc_framework_rules
Returns the rules defined by loaded compliance frameworks (SOC2, HIPAA, custom, etc.). Use to understand what the compliance requirements are.

### grc_impact_chain
Returns the cross-file impact tree for a given file — which files would be affected if this file changes. Use before refactoring shared modules.

### ask_checksagent
Ask the Checks Agent a natural-language compliance question. The Checks Agent has full access to all GRC tools and can reason about violations, frameworks, and risk. Use this when you need:
- Interpretation of a violation ("what does this rule mean for my code?")
- Cross-domain compliance feedback ("does this change affect SOC2 and HIPAA?")
- Remediation guidance ("how should I fix this blocking violation?")
- Confirmation that a planned change is compliant before making it
