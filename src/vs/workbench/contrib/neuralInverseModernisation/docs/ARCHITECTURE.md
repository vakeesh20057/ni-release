# NeuralInverse Modernisation — Architecture

## Overview

`neuralInverseModernisation` is a **compliance-governed legacy modernisation workflow engine** embedded in the Neural Inverse IDE. It orchestrates the full 12–24 month migration lifecycle for regulated enterprises — from legacy codebase discovery through to audited production cutover.

It does not replace the existing platform components. It is the workflow layer that connects them.

```
neuralInverseModernisation
        │
        ├── orchestrates ──► neuralInverse (agents: explorer, editor, verifier)
        ├── gates via ──────► neuralInverseChecks (GRC fingerprint comparison)
        ├── protects via ───► neuralInverseEnclave (legacy source before LLM)
        ├── translates via ─► void (LLM)
        └── runs heavy work via powerMode (batch execution sessions)
```

---

## Directory Structure

```
neuralInverseModernisation/
├── docs/                                      # Documentation (you are here)
│   ├── ARCHITECTURE.md
│   └── PRODUCT_VISION.md
│
├── common/
│   ├── modernisationTypes.ts                  # Core types (see below)
│   ├── modernisationConfigTypes.ts            # .neuralinversemodernisation config schema
│   └── legacyPatternRegistry.ts               # Known legacy patterns (COBOL, Java EE, etc.)
│
├── browser/
│   ├── neuralInverseModernisation.contribution.ts   # DI registration + commands + keybindings
│   │
│   ├── stage1-discovery/
│   │   ├── legacyAnalysisService.ts           # Codebase mapping, dependency graph
│   │   ├── businessLogicExtractor.ts          # LLM-powered plain-English extraction
│   │   └── complianceBaselineService.ts       # Runs initial GRC scan, stores baseline fingerprint
│   │
│   ├── stage2-planning/
│   │   ├── modernisationRoadmapService.ts     # Generates + sequences the migration backlog
│   │   ├── riskScoringService.ts              # Scores each unit: Low/Medium/High/Critical
│   │   └── approvalQueueService.ts            # Manages plan approval before migration starts
│   │
│   ├── stage3-migration/
│   │   ├── modernisationEngineService.ts      # Core orchestration: unit-by-unit translation
│   │   ├── fingerprintComparisonService.ts    # Compares legacy vs. modern compliance fingerprint
│   │   ├── translationApprovalQueue.ts        # Approval workflow for flagged translations
│   │   └── draftBufferService.ts              # Manages modern code as pending-approval draft
│   │
│   ├── stage4-validation/
│   │   ├── outputEquivalenceService.ts        # Runs legacy + modern against same inputs
│   │   └── equivalenceReportService.ts        # Generates test evidence for audit package
│   │
│   ├── stage5-cutover/
│   │   ├── complianceReportGenerator.ts       # Full audit package: changes, approvals, tests
│   │   ├── parallelRunMonitor.ts              # Monitors divergence in production parallel run
│   │   └── rollbackService.ts                 # Automatic rollback on production divergence
│   │
│   ├── engine/
│   │   ├── fingerprint/
│   │   │   ├── deterministicExtractor.ts      # Structural extraction of regulated attributes
│   │   │   └── llmSemanticExtractor.ts        # LLM-powered business rule extraction
│   │   │
│   │   └── parsers/
│   │       ├── cobolParser.ts                 # COBOL (IBM z/OS dialect) parser
│   │       ├── copyBookResolver.ts            # Resolves COBOL copybooks before parsing
│   │       ├── jclParser.ts                   # JCL job chain parser
│   │       └── parserRegistry.ts              # Maps language → parser
│   │
│   ├── ui/
│   │   ├── modernisationSessionEditorInput.ts # Two-window custom editor input
│   │   ├── legacyEditorPane.ts                # Left pane: read-only legacy view
│   │   ├── modernEditorPane.ts                # Right pane: draft buffer editor
│   │   ├── complianceStripWidget.ts           # Bottom strip: fingerprint match + approvals
│   │   ├── unitNavigator.ts                   # Left rail: migration unit list + status
│   │   └── modernisationDashboard.ts          # Enterprise migration dashboard panel
│   │
│   └── audit/
│       └── modernisationAuditService.ts       # Immutable audit trail for all migration events
```

---

## Core Types (`common/modernisationTypes.ts`)

```typescript
// A single unit of migration (COBOL paragraph, Java class, module)
interface IMigrationUnit {
    id: string;
    legacyFilePath: string;
    legacyRange: IRange;            // Location within the legacy file
    unitName: string;               // e.g. "CALC-LATE-FEE"
    unitType: 'paragraph' | 'section' | 'program' | 'module' | 'class' | 'function';
    riskLevel: MigrationRiskLevel;
    status: MigrationUnitStatus;
    dependencies: string[];         // IDs of units this unit depends on
    complianceFingerprint?: IComplianceFingerprint;
    modernFilePath?: string;
    modernRange?: IRange;
    approvals: IApprovalRecord[];
}

type MigrationRiskLevel = 'low' | 'medium' | 'high' | 'critical';

type MigrationUnitStatus =
    | 'pending'          // Not yet started
    | 'in-progress'      // Agent is translating
    | 'review'           // Translation complete, awaiting developer review
    | 'flagged'          // Fingerprint divergence detected, awaiting approval
    | 'approved'         // Approved, ready to commit
    | 'committed'        // Committed to version control
    | 'validated'        // Output equivalence test passed
    | 'complete';        // All stages done

// The compliance fingerprint — structured regulatory intent, not a hash
interface IComplianceFingerprint {
    unitId: string;
    extractedAt: number;
    deterministicFields: IRegulatedField[];     // From deterministic extractor
    semanticRules: ISemanticRule[];             // From LLM extractor
    complianceDomains: string[];                // Which GRC frameworks this touches
    invariants: ILogicalInvariant[];            // Mathematical/logical rules that must hold
}

interface IRegulatedField {
    fieldName: string;          // e.g. "WS-ACCT-BAL"
    regulatedAttribute: string; // e.g. "account_balance"
    framework: string;          // Which compliance framework classifies this
    operation: 'read' | 'write' | 'calculate' | 'transmit' | 'store';
}

interface ISemanticRule {
    description: string;        // Plain English: "Calculates late fee if balance > threshold after grace period"
    domain: string;             // e.g. "fee_calculation"
    preservationRequired: boolean;
}

interface ILogicalInvariant {
    description: string;        // e.g. "Result must equal COMP-3 packed decimal rounding of input"
    testable: boolean;          // Whether this can be verified in Stage 4
}

// Comparison result between legacy and modern fingerprints
interface IFingerprintComparison {
    unitId: string;
    legacyFingerprint: IComplianceFingerprint;
    modernFingerprint: IComplianceFingerprint;
    matchPercentage: number;    // 0–100
    divergences: IFingerprintDivergence[];
    overallResult: 'pass' | 'warning' | 'blocked';
}

interface IFingerprintDivergence {
    type: 'field-removed' | 'field-added' | 'rule-changed' | 'invariant-violated' | 'domain-added' | 'domain-removed';
    description: string;
    legacyLocation?: IRange;
    modernLocation?: IRange;
    severity: 'info' | 'warning' | 'blocking';
    requiresComplianceApproval: boolean;
}

// Approval record — part of the immutable audit trail
interface IApprovalRecord {
    id: string;
    unitId: string;
    approvalType: 'plan' | 'translation' | 'fingerprint-change' | 'equivalence-override';
    approvedBy: string;         // User identity
    approvedAt: number;
    rationale: string;
    fingerprintDiffAtApproval?: IFingerprintComparison;
    changeTicketRef?: string;   // e.g. Jira/ServiceNow reference for Critical units
}

// Output equivalence test result (Stage 4)
interface IEquivalenceResult {
    unitId: string;
    testCaseCount: number;
    passCount: number;
    failCount: number;
    divergences: IOutputDivergence[];
    evidenceRef: string;        // Path to test evidence included in audit package
}

interface IOutputDivergence {
    testCaseId: string;
    input: string;
    legacyOutput: string;
    modernOutput: string;
    divergenceType: 'value' | 'rounding' | 'missing-record' | 'extra-record' | 'checksum';
}
```

---

## Service Map

| Service | DI ID | Stage | Purpose |
|---------|-------|-------|---------|
| `ILegacyAnalysisService` | `modernisationLegacyAnalysis` | 1 | Codebase mapping, dependency graph |
| `IBusinessLogicExtractor` | `modernisationBusinessLogic` | 1 | LLM-powered plain-English extraction |
| `IComplianceBaselineService` | `modernisationComplianceBaseline` | 1 | Initial GRC scan + baseline fingerprint |
| `IModernisationRoadmapService` | `modernisationRoadmap` | 2 | Generate + sequence migration backlog |
| `IRiskScoringService` | `modernisationRiskScoring` | 2 | Score each unit: Low/Medium/High/Critical |
| `IApprovalQueueService` | `modernisationApprovalQueue` | 2 + 3 | Plan and translation approval workflow |
| `IModernisationEngineService` | `modernisationEngine` | 3 | Core unit-by-unit translation orchestration |
| `IFingerprintComparisonService` | `modernisationFingerprintComparison` | 3 | Compare legacy vs. modern fingerprints |
| `IDraftBufferService` | `modernisationDraftBuffer` | 3 | Manage modern code as pending draft |
| `IOutputEquivalenceService` | `modernisationOutputEquivalence` | 4 | Run legacy + modern against identical inputs |
| `IEquivalenceReportService` | `modernisationEquivalenceReport` | 4 | Generate test evidence for audit package |
| `IComplianceReportGenerator` | `modernisationComplianceReport` | 5 | Full audit package generation |
| `IParallelRunMonitor` | `modernisationParallelRunMonitor` | 5 | Production divergence monitoring |
| `IRollbackService` | `modernisationRollback` | 5 | Automatic rollback on divergence |
| `IModernisationAuditService` | `modernisationAudit` | All | Immutable audit trail |
| `IModernisationContextService` | `modernisationContext` | All | Shared context for two-window model |

---

## Platform Integration Points

### neuralInverseChecks (GRC Engine)
- Stage 1: `IGRCEngineService.evaluateFile()` on legacy codebase to establish baseline fingerprint
- Stage 3: `IGRCEngineService.evaluateFile()` on each translated unit, comparison against baseline
- `IContractReasonService` used for LLM-powered fingerprint semantic extraction
- Blocking violations from Checks halt migration steps automatically

### neuralInverseEnclave
- All legacy source content passes through `IEnclaveGatekeeperService.inspect()` before reaching the LLM
- Sensitive fields (credentials, account numbers, hardcoded constants) are intercepted and stored in a secure local redaction map
- After translation, redacted values are reinjected into the modern output before the developer sees it
- Provenance log records every file that was inspected: `IEnclaveProvenanceService.logAccess()`

### neuralInverse (Agent Bus)
- Stage 3 uses the sub-agent model:
  - `explorer` sub-agent: reads legacy unit, builds context
  - `editor` sub-agent: performs translation to target language
  - `verifier` sub-agent: runs tests, GRC checks, equivalence validation
- Orchestrated via `IWorkflowOrchestrator` with the modernisation workflow definition

### void (LLM Layer)
- Business logic extraction (Stage 1): one-shot query per unit
- Translation (Stage 3): streamed generation into the draft buffer
- Fingerprint semantic extraction: structured JSON output via `sendOneShotQuery`

### powerMode
- Heavy batch execution sessions (translating large programs) run in Power Mode
- `/modernise` command spawns an interactive modernisation session in Power Mode TUI
- Power Bus used for cross-service coordination during batch runs

---

## The Two-Window Editor (`ModernisationSessionEditorInput`)

A custom editor input that owns both panes and the compliance strip as a single managed session.

```
ModernisationSessionEditorInput
├── legacyEditorPane        (IEditorPane, read-only, COBOL/legacy source)
├── modernEditorPane        (IEditorPane, draft buffer, target language)
├── complianceStripWidget   (custom widget, fingerprint comparison + approval actions)
└── unitNavigator           (left rail, migration unit list, risk badges, status)
```

**Why custom input, not two separate editor groups:**
- Semantic scroll sync requires coordinating both panes from one controller
- The compliance strip is structurally part of the session — it cannot exist independently
- The draft buffer state (pending/approved) is session-level, not file-level
- The user cannot accidentally close one pane without ending the session

**Scroll synchronisation:**
Sync unit is the migration unit, not the line number. When the developer navigates to unit `CALC-LATE-FEE` on the left, the right pane jumps to `calculateLateFee()`. The unit navigator controls both panes simultaneously. The unit map is built during Stage 2 planning.

**Draft buffer visual treatment:**
- Modern pane background: distinct muted tone (not standard editor white/dark)
- Top banner: "PENDING APPROVAL — Unit 14 of 67 — [Approve] [Skip] [Block]"
- Once approved: background normalises, banner clears, file is written to disk

---

## Fingerprint Architecture

Two-layer extraction running on every unit:

```
Legacy Unit (post-Enclave redaction)
            │
    ┌───────┴────────────────────────┐
    │                                │
    ▼                                ▼
Deterministic Extractor          LLM Semantic Extractor
(no LLM, fast)                   (via void, structured output)
    │                                │
    ▼                                ▼
IRegulatedField[]                ISemanticRule[]
ILogicalInvariant[]              IComplianceDomain[]
    │                                │
    └───────────────┬────────────────┘
                    │
             IComplianceFingerprint
                    │
          ┌─────────┴──────────┐
          │ (for modern unit)  │
          ▼                    ▼
  IComplianceFingerprint   compared via
  (modern)                 IFingerprintComparisonService
                                │
                          IFingerprintComparison
                          matchPercentage: 0–100
                          divergences[]
                          overallResult: pass | warning | blocked
```

**Comparison is structural, not syntactic.** Two fingerprints are compared by:
1. Are all regulated fields from the legacy unit present in the modern unit?
2. Are all semantic rules preserved?
3. Are all logical invariants satisfied?
4. Have any new compliance domains been introduced that weren't in the legacy unit?

A 94% match means: one regulated field interaction changed or one semantic rule was not fully preserved. The compliance strip shows exactly which divergence was detected and where.

---

## Audit Trail

Every migration event writes an immutable audit record via `IModernisationAuditService`:

| Event | Recorded Data |
|-------|--------------|
| Stage 1 complete | Legacy map snapshot, baseline fingerprint, GRC scan results |
| Stage 2 approved | Roadmap version, approver, timestamp, risk distribution |
| Translation started | Unit ID, agent session ID, legacy fingerprint |
| Fingerprint divergence | Full comparison object, divergences, blocking status |
| Approval granted | Approver, rationale, fingerprint diff at approval time, ticket ref |
| Equivalence test pass | Test case count, evidence file path |
| Equivalence test fail | Divergence details, blocking status |
| Unit committed | Commit hash, final fingerprint, approval chain |
| Cutover approved | Compliance report ref, parallel run start time |
| Production divergence | Divergence details, rollback triggered, timestamp |

The audit trail is the primary deliverable handed to regulators. It must be tamper-evident. Implementation mirrors `auditTrailService.ts` in neuralInverseChecks (hash-chained records).

---

## Build Phases

### Phase 0 — Proof of Concept (Before Any UI)
Validate the fingerprint extractor before committing to the full build.

| Step | What | Service / File |
|------|------|----------------|
| 0.1 | Define all types | `modernisationTypes.ts` |
| 0.2 | Build deterministic extractor for COBOL | `deterministicExtractor.ts` |
| 0.3 | Build LLM semantic extractor | `llmSemanticExtractor.ts` |
| 0.4 | Build fingerprint comparison | `fingerprintComparisonService.ts` |
| 0.5 | Spike: 10 COBOL paragraphs → translate → compare fingerprints | Manual test |

**Gate:** Only proceed to Phase 1 if fingerprint comparison correctly identifies deliberate regulatory logic changes and passes cleanly on correct translations.

---

### Phase 1 — Stage 1: Discovery

| Step | What | Service / File |
|------|------|----------------|
| 1.1 | COBOL parser (IBM z/OS dialect) | `cobolParser.ts` |
| 1.2 | Copybook resolver | `copyBookResolver.ts` |
| 1.3 | JCL parser | `jclParser.ts` |
| 1.4 | Dependency graph builder | `legacyAnalysisService.ts` |
| 1.5 | Business logic extractor (LLM) | `businessLogicExtractor.ts` |
| 1.6 | Compliance baseline scan | `complianceBaselineService.ts` |

---

### Phase 2 — Stage 2: Planning

| Step | What | Service / File |
|------|------|----------------|
| 2.1 | Risk scoring algorithm | `riskScoringService.ts` |
| 2.2 | Dependency-ordered backlog generation | `modernisationRoadmapService.ts` |
| 2.3 | Plan approval workflow + logging | `approvalQueueService.ts` |

---

### Phase 3 — Stage 3: Migration + Two-Window UI

| Step | What | Service / File |
|------|------|----------------|
| 3.1 | Draft buffer service | `draftBufferService.ts` |
| 3.2 | Modernisation engine (translation orchestration) | `modernisationEngineService.ts` |
| 3.3 | Two-window custom editor input | `modernisationSessionEditorInput.ts` |
| 3.4 | Legacy pane + modern pane | `legacyEditorPane.ts`, `modernEditorPane.ts` |
| 3.5 | Compliance strip widget | `complianceStripWidget.ts` |
| 3.6 | Unit navigator | `unitNavigator.ts` |
| 3.7 | Translation approval queue | `translationApprovalQueue.ts` |

---

### Phase 4 — Stage 4: Validation

| Step | What | Service / File |
|------|------|----------------|
| 4.1 | Output equivalence test runner | `outputEquivalenceService.ts` |
| 4.2 | Evidence report generator | `equivalenceReportService.ts` |

---

### Phase 5 — Stage 5: Cutover + Dashboard

| Step | What | Service / File |
|------|------|----------------|
| 5.1 | Compliance report generator | `complianceReportGenerator.ts` |
| 5.2 | Parallel run monitor | `parallelRunMonitor.ts` |
| 5.3 | Rollback service | `rollbackService.ts` |
| 5.4 | Enterprise migration dashboard | `modernisationDashboard.ts` |

---

### Phase 6 — Power Mode Integration

| Step | What |
|------|------|
| 6.1 | Register `/modernise` command in Power Mode |
| 6.2 | Power Mode session spawns modernisation agent for batch translation runs |
| 6.3 | Power Bus integration for cross-service coordination |

---

## Key Commands

| Command | Description |
|---------|-------------|
| `neuralInverse.modernisation.startDiscovery` | Run Stage 1 discovery on workspace |
| `neuralInverse.modernisation.openRoadmap` | Open Stage 2 planning view |
| `neuralInverse.modernisation.openSession` | Open two-window migration session for selected unit |
| `neuralInverse.modernisation.approveUnit` | Approve current unit and advance to next |
| `neuralInverse.modernisation.blockUnit` | Block unit and flag for compliance review |
| `neuralInverse.modernisation.runEquivalenceTest` | Trigger Stage 4 output equivalence test |
| `neuralInverse.modernisation.generateReport` | Generate Stage 5 compliance audit package |
| `neuralInverse.modernisation.openDashboard` | Open enterprise migration dashboard |
