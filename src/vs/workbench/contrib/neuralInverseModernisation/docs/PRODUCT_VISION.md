# NeuralInverse Modernisation — Product Vision

## Core Thesis

> **Modernisation is not a feature you add. It's a workflow that a regulated enterprise runs over 12–24 months. This platform owns that entire workflow.**

Every other modernisation tool (GitHub Copilot Workspace, Amazon Q Transform, Moderne, Replit Agent) stops at Stage 3 — the translation step. They are built for startups rewriting messy microservices, not banks migrating core banking systems.

They have no compliance layer, no approval workflow, no audit trail, no enclave protection, no output validation. We do. Every piece already exists in the platform. Modernisation is the workflow that connects them.

---

## The Five-Stage Workflow

### Stage 1 — Discovery

**Question answered: "What do we actually have and what are we not allowed to break?"**

Before anyone touches a line of code, the platform must understand what it is dealing with. The developer opens NeuralInverse Modernisation, points it at the legacy codebase, and three things happen automatically:

1. **Codebase Mapping** — every file, every dependency, every program that calls every other program. For COBOL this means resolving copybooks, JCL job chains, and CICS transaction programs into a full dependency graph.
2. **Business Logic Extraction** — the compliance fingerprint of the legacy code is extracted in plain English so a human can read what the code actually does without understanding COBOL. This extraction uses the LLM via Void, but only after the Enclave has scanned and redacted sensitive fields.
3. **Compliance Baseline** — NeuralInverseChecks runs a full GRC scan on the legacy code, establishing a baseline fingerprint of all regulatory logic before migration begins. This baseline is the reference for every comparison that follows.

---

### Stage 2 — Planning

**Question answered: "What order do we do this in and who signs off before we start?"**

The platform breaks the migration into atomic units. For COBOL: one paragraph, one module, one program at a time. Each unit gets a risk score:

| Risk Level | Meaning |
|------------|---------|
| **Low** | No regulatory logic identified. Standard translation. |
| **Medium** | References regulated data fields or controlled processes. |
| **High** | Contains business rules that appear in compliance frameworks. |
| **Critical** | Core regulatory logic — fee calculation, transaction settlement, audit trail generation. |

The migration backlog is generated automatically, sequenced by dependency order (a program cannot be migrated before all programs it depends on). The enterprise's compliance team reviews and approves the plan before a single line is touched. This approval is logged and forms part of the final audit package.

---

### Stage 3 — Migration

**Question answered: "How do we move fast without breaking compliance?"**

Unit by unit, the AI translates legacy code to the target language. What makes this different:

- After each translation unit, NeuralInverseChecks runs a GRC scan comparing the **compliance fingerprint of the legacy unit** against the **translated unit**.
- If the fingerprint changes — meaning regulatory logic has been altered — the migration step is **blocked** until a compliance officer explicitly approves the change.
- Nothing gets committed automatically. Everything flows through the approval queue.
- The Enclave protects legacy source code: sensitive values (credentials, account numbers, hardcoded constants) are intercepted before the LLM sees them, stored in a secure local map, and re-injected after translation.

The two-window model (see Architecture) makes this visible in real time: legacy on the left, modern on the right, compliance fingerprint comparison strip at the bottom.

---

### Stage 4 — Validation

**Question answered: "How do we prove to a regulator that nothing changed that shouldn't have?"**

After translation, the platform runs legacy and modern code side by side against identical inputs and compares outputs:

- For a bank: validating to the cent.
- For a batch system: matching record counts and checksums exactly.
- For a telecom billing system: matching call records, charge amounts, and tax calculations exactly.

Any divergence is flagged immediately. The developer cannot mark a unit complete until the output equivalence test passes. This test result is automatically included in the audit package — it is the evidence that the migration worked correctly.

---

### Stage 5 — Cutover

**Question answered: "How do we go live without anyone losing their job over it?"**

The platform generates a complete compliance report:
- Legacy vs. modern: every change logged
- Every approval recorded with timestamp and approver identity
- Every test result included
- Ready to hand to a regulator or auditor without additional work

Parallel running is monitored in real time. If divergence appears in production, rollback is automatic. The enterprise dashboard shows: overall migration progress, compliance posture, outstanding approvals, risk distribution.

---

## Why Our Platform Is the Only One That Can Do This

```
                     Stage 1    Stage 2    Stage 3    Stage 4    Stage 5
                    Discovery   Planning  Migration  Validation  Cutover
                    ─────────  ─────────  ─────────  ─────────  ─────────
GitHub Copilot WS      ✗          ✗         partial     ✗          ✗
Amazon Q Transform     partial    ✗         partial     ✗          ✗
Moderne                ✗          partial   partial     ✗          ✗
NeuralInverse          ✓          ✓         ✓           ✓          ✓
```

| Capability | Platform Component |
|------------|-------------------|
| Compliance fingerprint extraction | neuralInverseChecks (GRC engine + contractReasonService) |
| Approval workflow | neuralInverseChecks (gatekeeper) + IAM engine |
| Audit trail | neuralInverseChecks (auditTrailService) |
| Legacy code protection before LLM | neuralInverseEnclave (gatekeeperService + sandboxService) |
| Output equivalence validation | neuralInverse agents (verifier sub-agent role) |
| AI translation execution | void (LLM layer) |
| Batch workflow orchestration | powerMode (Power Mode execution) |
| Enterprise migration dashboard | neuralInverseModernisation (new contrib) |

---

## The Compliance Fingerprint — Core IP

The fingerprint is not a hash. It is a **structured JSON artifact** that represents the regulatory intent of a unit of code. This is the asset that makes the comparison meaningful.

Two layers:

### Layer 1 — Deterministic Extraction
Structural identification of regulated attributes:
- Data division fields that map to regulated data (account numbers, transaction amounts, audit codes, personal identifiers)
- Known regulatory keywords and constants
- Controlled program flow patterns (end-of-day settlement, reconciliation loops, interest calculation)

This layer runs without the LLM and produces fast, deterministic results for known patterns.

### Layer 2 — LLM Semantic Extraction
For logic that cannot be identified structurally, the LLM (via Void, after Enclave processing) extracts:
- The business rule in plain English: "This paragraph calculates the late fee if balance exceeds threshold after the grace period."
- Which compliance domains this logic touches
- The mathematical or logical invariants that must be preserved

The fingerprint of a legacy unit and its modern translation are compared structurally. The comparison answers: **"Did the regulatory meaning change?"** — not "did the syntax change."

---

## The Two-Window Model

The developer works in two editor panes opened as a single managed session:

```
┌──────────────────────────┬──────────────────────────┐
│  LEGACY  (read-only)     │  MODERN  (draft buffer)  │
│  COBOL source            │  TypeScript / Java       │
│                          │                          │
│  CALC-LATE-FEE           │  calculateLateFee()      │
│  (highlighted unit)      │  (highlighted unit)      │
│                          │                          │
├──────────────────────────┴──────────────────────────┤
│  COMPLIANCE STRIP                                   │
│  Fingerprint match: 94%  |  Unit 14 of 67           │
│  WARNING: Fee rounding logic diverged (line 8)      │
│  [View Diff]  [Approve Change]  [Block & Reassign]  │
└─────────────────────────────────────────────────────┘
```

**Key principles:**
- Left window is read-only. The legacy codebase is the source of truth. Nothing gets edited there.
- Right window is a **draft buffer** — not a committed file until the unit is approved. Clearly marked as pending.
- Scroll sync is **semantic, not line-based**. A 60-line COBOL paragraph may become 15 lines of TypeScript. Sync is by migration unit, not line number.
- Both windows feed into one shared context that all platform services see simultaneously.

### Shared Context Architecture

```
LEFT WINDOW (Legacy)           RIGHT WINDOW (Modern)
COBOL source                   TypeScript / Java
      │                               │
      └──────────┬────────────────────┘
                 │
         MODERNISATION CONTEXT SERVICE
         (IModernisationContextService)
                 │
    ┌────────────┼──────────────┬──────────────┐
    │            │              │              │
 Checks       Agents         Enclave        Void LLM
 (GRC scan    (reads         (protects      (translates
  both sides,  legacy,        legacy before  units on
  compares     writes         LLM sees it)   demand)
  fingerprint) modern)
```

NeuralInverseChecks sees both sides simultaneously. It builds the compliance fingerprint from the left and validates the right against it in real time. As the modern code is edited, Checks constantly evaluates whether the regulatory logic from the original is still intact.

---

## Layout Decision

**Use a custom editor input (`ModernisationSessionEditorInput`), not two separate editor groups.**

Reasons:
- Semantic scroll synchronisation requires coordinating both panes from one controller
- The compliance strip is part of the session layout — it cannot exist independently
- The user must not be able to accidentally close one side without closing the session

**The compliance comparison strip sits below both editors as a horizontal bar**, not in the Checks sidebar. The sidebar Checks panel is for workspace-level GRC posture. The inline strip is for unit-level fingerprint comparison. Different scopes, different surfaces.

---

## Approval Authority

Two tiers of approval authority:

| Risk Level | Approved By |
|------------|-------------|
| Low | Senior developer (in-IDE approval) |
| Medium | Senior developer + tech lead sign-off |
| High | Compliance officer (can approve from web console or in-IDE) |
| Critical | Compliance officer + change management ticket reference required |

The approval workflow is logged in the audit trail with: approver identity, timestamp, rationale (free text), and the compliance fingerprint diff at time of approval.

---

## First Customer Considerations — Telecom / COBOL

When targeting a telecom modernisation engagement, the legacy stack is likely **IBM z/OS COBOL** for billing systems. Key challenges specific to this stack:

| Challenge | Implication for Parser |
|-----------|----------------------|
| **CICS transaction programs** | Not batch — event-driven. Parser must understand CICS command verbs (`EXEC CICS READ`, `EXEC CICS WRITE`). |
| **Copybooks** | Shared data definitions across programs. The parser must resolve copybooks before extracting field semantics. A field named `WS-ACCT-BAL` in a copybook is the same regulated attribute wherever it appears. |
| **JCL** | Job Control Language orchestrates program execution. The Legacy Map must include JCL to understand what programs run, in what order, on what schedule. |
| **COMP-3 packed decimal** | COBOL `COMP-3` handles currency arithmetic with specific rounding behaviour. Most target languages produce different rounding for the same inputs. This is the most common source of output divergence in Stage 4. |
| **COBOL dialect** | IBM z/OS COBOL differs from open-source COBOL implementations. The parser must target the correct dialect. |

**Critical decision before building the parser:** Determine whether the target programs are batch (`PROCEDURE DIVISION` with `STOP RUN`) or CICS transaction programs (`EXEC CICS RETURN`). This determines whether Stage 4 output equivalence can be run with file-based test harnesses or requires a CICS emulator.

---

## Proof of Concept — What to Validate First

Before building any UI, run a fingerprint spike:

1. Take 10 COBOL paragraphs from a public banking or utility codebase
2. Build the fingerprint extractor (both layers: deterministic + LLM)
3. Translate each paragraph to the target language
4. Compare fingerprints: legacy vs. modern
5. Introduce a deliberate regulatory logic change in one translation
6. Verify the fingerprint comparison catches it
7. Verify the comparison passes cleanly when the translation is correct

If the fingerprint comparison is reliable enough to be trustworthy, the entire workflow is viable. If it is noisy — too many false positives or false negatives — the compliance gate becomes the bottleneck that stops the migration. This must be validated before UI work begins.

---

## Open Questions for Team

| Question | Why It Matters |
|----------|---------------|
| Is the first target customer on CICS or batch COBOL? | Determines whether Stage 4 needs a CICS emulator |
| What is the approval authority model — in-IDE only, or web console for compliance officers? | Changes the IAM integration scope |
| What is the rollback mechanism — git-based revert, or our own snapshot system? | Affects how draft buffer state is managed |
| Which regulated frameworks apply to the first customer? | Determines which compliance fingerprint rules to build first |
| Does the Enclave need to operate fully air-gapped, or is network-isolated sufficient? | Determines infrastructure requirements for the first deployment |
