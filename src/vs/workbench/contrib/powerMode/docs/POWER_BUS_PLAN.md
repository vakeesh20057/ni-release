# Power Mode — Inter-Agent Communication Bus Plan

## Why Two Separate Buses

The system has two distinct communication layers that will eventually connect:

```
┌─────────────────────────────────────────────────────────┐
│                    Neural Inverse IDE                    │
│                                                         │
│   ┌──────────────────┐        ┌────────────────────┐   │
│   │    PowerBus      │◄──────►│    ChecksBus       │   │
│   │  (this doc)      │        │  (checks side)     │   │
│   │                  │        │                    │   │
│   │  GATED           │        │  OPEN              │   │
│   │  Powerful        │        │  Any agent can     │   │
│   │  Tool execution  │        │  subscribe         │   │
│   └──────────────────┘        └────────────────────┘   │
│          │                            │                 │
│   Power Mode                  neuralInverseChecks       │
│   Permission UI               GRC Engine               │
│   LLM Sessions                Framework Rules          │
└─────────────────────────────────────────────────────────┘
```

**PowerBus is gated** because Power Mode can execute bash, write files, edit code, and run
arbitrary commands. Any agent that connects through PowerBus inherits that capability via
the permission proxy. That power requires a gate.

**ChecksBus is open** because neuralInverseChecks is read-oriented — it analyzes, scores,
and reports compliance. Any agent can safely subscribe to compliance events without risk.

They are not the same bus. They connect at a defined bridge point (built later).

---

## PowerBus Architecture

### Core Concept

PowerBus is an LLM-to-LLM communication layer. Each participant is a full LLM session
with its own context window, system prompt, and reasoning. The bus carries messages between
them — not tool calls, not state, just text.

Power Mode acts as the **execution gatekeeper**. If any connected agent needs to run a tool
(bash, write, edit), it requests it through PowerBus. Power Mode intercepts the request,
shows the user the existing permission prompt (the one already built), and routes the result
back. The user sees one consistent permission UI regardless of which agent initiated the action.

```
Agent B needs to run bash
        │
        ▼
Agent B sends { type: 'tool-request', tool: 'bash', args: {...} } to PowerBus
        │
        ▼
Power Mode receives it → shows permission prompt to user
  ⚠  bash  <command>
  y · yes   a · yes all   n · no
        │
        ▼
User approves → Power Mode executes → result sent back to Agent B via bus
```

### Message Shape

```typescript
interface IAgentBusMessage {
  id: string;
  from: string;             // 'power-mode' | 'checks-agent' | 'sub-agent:explorer' | etc.
  to: string | '*';         // specific agent ID or broadcast
  type: AgentMessageType;
  content: string;          // plain text — LLM-generated
  timestamp: number;
  replyTo?: string;         // for threading replies
  depth: number;            // chain depth — drop if > 5 (circular loop guard)
  sessionRef?: string;      // reference to the sender's current session ID
}

type AgentMessageType =
  | 'query'           // Agent asking another agent something
  | 'response'        // Reply to a query
  | 'tool-request'    // Agent requesting Power Mode execute a tool
  | 'tool-result'     // Power Mode returning the result
  | 'broadcast'       // One-to-all notification
  | 'handoff'         // Context limit reached — passing context summary + new session ref
  | 'handoff-ack';    // Recipient acknowledges the handoff
```

### Participants (Phase 1)

| Agent ID | Description | Can Send | Can Receive |
|---|---|---|---|
| `power-mode` | Power Mode LLM sessions | All types | All types |
| `neural-agent` | NeuralInverse workflow agent | query, response, broadcast | query, response, tool-result, handoff |
| `sub-agent:*` | NeuralInverse sub-agents | query, response | query, response, tool-result |

---

## LLM-to-LLM Communication Model

Each agent is an independent LLM session:
- Its own context window
- Its own system prompt / identity
- Its own reasoning thread

The bus is just the wire. When Agent A sends a query to Agent B, Agent B's LLM actually
*thinks* about it and generates a real response. This is not state forwarding. It is two
language models having a conversation, each bringing their own knowledge and context.

```
Agent A (Power Mode LLM)           Agent B (Checks Agent LLM)
         │                                    │
         │  "Does this edit to auth.ts        │
         │   violate any GRC rules?"          │
         │ ─────────────────────────────────► │
         │                                    │  [thinks]
         │                                    │  [reads its framework rules]
         │  "Yes — rule NI-SEC-004:           │
         │   no direct DB writes outside      │
         │   repository layer"                │
         │ ◄───────────────────────────────── │
         │                                    │
   [Power Mode pauses edit,                   │
    shows warning to user]                    │
```

---

## Context Limit Handling

Each LLM session has a finite context window. Token usage is tracked per step via
`step-finish` events (already in the processor). When an agent detects it is approaching
its limit (e.g. 80% of its model's context), it initiates a graceful handoff.

### Handoff Protocol

```
Step 1 — Detect
  Agent monitors cumulative token count from step-finish events.
  Threshold: 80% of model context window.

Step 2 — Summarize
  Agent sends itself a final LLM prompt:
  "Summarize everything we have done in this session so far.
   Include: decisions made, files changed, current task state,
   open questions, and what the next agent should do first."

Step 3 — Broadcast handoff
  Agent sends a 'handoff' message to all connected agents:
  {
    type: 'handoff',
    content: <the summary>,
    sessionRef: <old session ID>,
    newSessionRef: <new session ID being started>
  }

Step 4 — Start fresh
  Agent creates a new LLM session, pre-loaded with the summary as
  its initial system context. The new session continues seamlessly.

Step 5 — Acknowledge
  Connected agents receive 'handoff', update their routing table
  to point to the new session ID for future messages.
```

### Why the LLM generates the summary

The LLM knows what was important. A mechanical summary (last N messages) loses semantic
context. The model understands which decisions mattered, which were exploratory dead ends,
and what the next session actually needs to know. This produces a much tighter, more useful
handoff document than any rule-based truncation.

---

## The Gate

PowerBus is not open. Agents must be registered to connect.

```typescript
interface IPowerBusGate {
  // Only registered agents can publish or subscribe
  register(agentId: string, capabilities: AgentCapability[]): void;
  unregister(agentId: string): void;

  // Tool requests must go through the gate — routed to Power Mode permission UI
  requestTool(from: string, tool: string, args: Record<string, any>): Promise<string>;

  // Message depth enforcement — drops circular chains
  canDeliver(message: IAgentBusMessage): boolean;
}

type AgentCapability =
  | 'send:query'
  | 'send:tool-request'    // Only agents that need execution
  | 'receive:tool-result'
  | 'broadcast';
```

The gate enforces:
1. Only registered agents can communicate
2. `tool-request` capability must be explicitly granted
3. Message depth > 5 is dropped (circular loop protection)
4. Tool execution always routes through Power Mode's existing permission UI

---

## Bridge to ChecksBus (Future)

ChecksBus is built independently by the checks team. When both buses exist, they connect
at a single bridge point. The bridge is one-directional by default:

```
ChecksBus ──► PowerBus bridge ──► Power Mode
```

ChecksBus can send `broadcast` and `query` messages through the bridge. It cannot send
`tool-request` (the bridge strips that capability). Power Mode can optionally subscribe
to compliance events from ChecksBus (e.g. "rule violation detected while agent was editing").

The bridge is built when both sides are ready. Neither bus depends on the other existing.

---

## Build Phases

### Phase 1 — PowerBus Core (this repo, powerMode only)
- `common/powerBusTypes.ts` — message types, capabilities, gate interface
- `browser/powerBusService.ts` — DI singleton, pub/sub, gate enforcement
- Wire into `powerModeService.ts` — subscribe, handle tool-requests, show permission UI
- New slash command `/agents` — shows connected agents and recent bus messages in terminal

### Phase 2 — First External Agent
- Wire `neuralInverseAgentService` into PowerBus
- Agent can query Power Mode: "what did you last change?"
- Power Mode can query agent: "is this task safe to auto-approve?"

### Phase 3 — Context Handoff
- Token tracking in sessions → trigger handoff at 80%
- LLM-generated summary on handoff
- New session pre-loading with summary context

### Phase 4 — ChecksBus Bridge
- Built after ChecksBus exists on the checks side
- Bridge service connects the two — one-directional, capability-stripped
- Power Mode subscribes to compliance broadcast events

---

## Key Invariants

1. The bus carries **text only**. No tool schemas, no file buffers, no binary data.
2. **Tool execution always goes through Power Mode** and always requires user permission.
3. **Context handoffs are LLM-generated** — never mechanical truncation.
4. **PowerBus is gated** — ChecksBus is open. They are different systems.
5. **Circular loop depth limit: 5**. Beyond that, the message is dropped and surfaced to user.
6. **Each agent is a full LLM session** — it reasons, it doesn't just relay.
