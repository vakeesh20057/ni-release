# NeuralInverse Modernisation -- Architecture

## Overview

`neuralInverseModernisation` is a **compliance-governed legacy modernisation workflow engine** embedded in the Neural Inverse IDE. It orchestrates the full migration lifecycle for regulated codebases -- from legacy discovery through to audited production cutover.

It does not replace the existing platform components. It is the workflow layer that connects them.

```
neuralInverseModernisation
        |
        +-- orchestrates --> neuralInverse (agents: explorer, editor, verifier)
        +-- gates via -----> neuralInverseChecks (GRC fingerprint comparison)
        +-- translates via-> void (LLM)
        +-- runs heavy work via powerMode (batch execution sessions)
```

> Note: Backend sync and compliance dashboard are available in NeuralInverse Enterprise.

---

## Directory Structure

```
neuralInverseModernisation/
+-- docs/                                      # Documentation (you are here)
|   +-- ARCHITECTURE.md
|   +-- PRODUCT_VISION.md
|   +-- MODERNISATION_PLATFORM_PLAN.md
|   +-- phase-12-autonomy.md
|
+-- common/
|   +-- modernisationTypes.ts                  # Core types (see below)
|   +-- modernisationConfigTypes.ts            # .neuralinversemodernisation config schema
|   +-- legacyPatternRegistry.ts               # Known legacy patterns (COBOL, Java EE, etc.)
|
+-- browser/
    +-- neuralInverseModernisation.contribution.ts   # DI registration + commands + keybindings
    |
    +-- engine/
    |   +-- discovery/                         # Stage 1: codebase scanning and unit decomposition
    |   +-- planning/                          # Stage 2: roadmap generation and compliance ordering
    |   +-- resolution/                        # Source resolution and dependency inlining
    |   +-- translation/                       # Stage 3: LLM-driven unit translation
    |   +-- fingerprint/                       # Compliance fingerprint extraction and comparison
    |   +-- cutover/                           # Stage 5: audit export and file commit
    |   +-- autonomy/                          # Phase 12: autonomous migration loop
    |
    +-- knowledgeBase/                         # Persistent KB: units, decisions, glossary, audit log
    |
    +-- ui/
    |   +-- modernisationConsole.ts            # Main console shell
    |   +-- modernisationPart.ts               # Aux-window entry point
    |   +-- views/                             # Unit index, decision log, progress views
    |   +-- editor/                            # Two-window per-unit translation editor
    |
    +-- modernisationSessionService.ts         # Session lifecycle (active session, stage, plan)
    +-- modernisationSyncService.ts            # CE stub -- backend sync is an Enterprise feature
    +-- modernisationAuditService.ts           # Immutable audit trail for all migration events
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

// The compliance fingerprint -- structured regulatory intent, not a hash
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
    matchPercentage: number;    // 0-100
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

// Approval record -- part of the immutable audit trail
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
| `IModernisationSessionService` | `modernisationSessionService` | All | Session lifecycle, stage transitions |
| `IKnowledgeBaseService` | `knowledgeBaseService` | All | Persistent KB: units, decisions, glossary |
| `IDiscoveryService` | `discoveryService` | 1 | Codebase scanning and unit decomposition |
| `IMigrationPlannerService` | `migrationPlannerService` | 2 | Roadmap generation and compliance ordering |
| `ISourceResolutionService` | `sourceResolutionService` | 2-3 | Dependency inlining for all source languages |
| `ITranslationEngineService` | `translationEngineService` | 3 | LLM-driven unit translation |
| `IFingerprintService` | `fingerprintService` | 3 | Compliance fingerprint extraction and comparison |
| `ICutoverService` | `cutoverService` | 5 | Audit export and file commit |
| `IAutonomyService` | `autonomyService` | 12 | Autonomous migration loop controller |
| `IModernisationSyncService` | `modernisationSyncService` | All | CE stub -- no-op (Enterprise feature) |
| `IModernisationAuditService` | `modernisationAudit` | All | Immutable audit trail |

---

## Platform Integration Points

### neuralInverseChecks (GRC Engine)
- Stage 1: `IGRCEngineService.evaluateFile()` on legacy codebase to establish baseline fingerprint
- Stage 3: `IGRCEngineService.evaluateFile()` on each translated unit, comparison against baseline
- `IContractReasonService` used for LLM-powered fingerprint semantic extraction
- Blocking violations from Checks halt migration steps automatically

### neuralInverse (Agent Bus)
- Stage 3 uses the sub-agent model:
  - `explorer` sub-agent: reads legacy unit, builds context
  - `editor` sub-agent: performs translation to target language
  - `verifier` sub-agent: runs tests, GRC checks, equivalence validation
- Phase 12 autonomy loop drives independent units in parallel via `INeuralInverseSubAgentService`

### void (LLM Layer)
- Business logic extraction (Stage 1): one-shot query per unit
- Translation (Stage 3): streamed generation into the draft buffer
- Fingerprint semantic extraction: structured JSON output via `sendOneShotQuery`

### powerMode
- Heavy batch execution sessions (translating large programs) run in Power Mode
- `/modernise` command spawns an interactive modernisation session in Power Mode TUI
- Power Bus used for cross-service coordination during batch runs

---

## The Two-Window Editor (`ModernisationUnitEditorInput`)

A custom editor input that owns both panes and the compliance strip as a single managed session.

```
ModernisationUnitEditorInput
+-- legacyEditorPane        (IEditorPane, read-only, COBOL/legacy source)
+-- modernEditorPane        (IEditorPane, draft buffer, target language)
+-- complianceStripWidget   (custom widget, fingerprint comparison + approval actions)
+-- unitNavigator           (left rail, migration unit list, risk badges, status)
```

**Why custom input, not two separate editor groups:**
- Semantic scroll sync requires coordinating both panes from one controller
- The compliance strip is structurally part of the session -- it cannot exist independently
- The draft buffer state (pending/approved) is session-level, not file-level
- The user cannot accidentally close one pane without ending the session

**Scroll synchronisation:**
Sync unit is the migration unit, not the line number. When the developer navigates to unit `CALC-LATE-FEE` on the left, the right pane jumps to `calculateLateFee()`. The unit navigator controls both panes simultaneously. The unit map is built during Stage 2 planning.

**Draft buffer visual treatment:**
- Modern pane background: distinct muted tone (not standard editor white/dark)
- Top banner: "PENDING APPROVAL -- Unit 14 of 67 -- [Approve] [Skip] [Block]"
- Once approved: background normalises, banner clears, file is written to disk

---

## Fingerprint Architecture

Two-layer extraction running on every unit:

```
Legacy Unit
    |
    +-------------------------------+
    |                               |
    v                               v
Deterministic Extractor         LLM Semantic Extractor
(no LLM, fast)                  (via void, structured output)
    |                               |
    v                               v
IRegulatedField[]               ISemanticRule[]
ILogicalInvariant[]             IComplianceDomain[]
    |                               |
    +---------------+---------------+
                    |
             IComplianceFingerprint
                    |
          +---------+---------+
          |                   |
          v                   v
  IComplianceFingerprint   compared via
  (modern)                 IFingerprintService
                                |
                          IFingerprintComparison
                          matchPercentage: 0-100
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

The audit trail is the primary deliverable for regulatory review. It is tamper-evident (hash-chained records, same pattern as `auditTrailService.ts` in neuralInverseChecks).

---

## Build Phases

### Phase 0 -- Proof of Concept (Before Any UI)
Validate the fingerprint extractor before committing to the full build.

| Step | What | Service / File |
|------|------|----------------|
| 0.1 | Define all types | `modernisationTypes.ts` |
| 0.2 | Build deterministic extractor for COBOL | `deterministicExtractor.ts` |
| 0.3 | Build LLM semantic extractor | `llmSemanticExtractor.ts` |
| 0.4 | Build fingerprint comparison | `fingerprintComparisonService.ts` |
| 0.5 | Spike: 10 COBOL paragraphs -> translate -> compare fingerprints | Manual test |

**Gate:** Only proceed to Phase 1 if fingerprint comparison correctly identifies deliberate regulatory logic changes and passes cleanly on correct translations.

---

### Phase 1 -- Stage 1: Discovery

| Step | What | Service / File |
|------|------|----------------|
| 1.1 | COBOL parser (IBM z/OS dialect) | `cobolParser.ts` |
| 1.2 | Copybook resolver | `copyBookResolver.ts` |
| 1.3 | JCL parser | `jclParser.ts` |
| 1.4 | Dependency graph builder | `legacyAnalysisService.ts` |
| 1.5 | Business logic extractor (LLM) | `businessLogicExtractor.ts` |
| 1.6 | Compliance baseline scan | `complianceBaselineService.ts` |

---

### Phase 2 -- Stage 2: Planning

| Step | What | Service / File |
|------|------|----------------|
| 2.1 | Risk scoring algorithm | `riskScoringService.ts` |
| 2.2 | Dependency-ordered backlog generation | `modernisationRoadmapService.ts` |
| 2.3 | Plan approval workflow + logging | `approvalQueueService.ts` |

---

### Phase 3 -- Stage 3: Migration + Two-Window UI

| Step | What | Service / File |
|------|------|----------------|
| 3.1 | Draft buffer service | `draftBufferService.ts` |
| 3.2 | Modernisation engine (translation orchestration) | `modernisationEngineService.ts` |
| 3.3 | Two-window custom editor input | `modernisationUnitEditorInput.ts` |
| 3.4 | Legacy pane + modern pane | `legacyEditorPane.ts`, `modernEditorPane.ts` |
| 3.5 | Compliance strip widget | `complianceStripWidget.ts` |
| 3.6 | Unit navigator | `unitNavigator.ts` |
| 3.7 | Translation approval queue | `translationApprovalQueue.ts` |

---

### Phase 4 -- Stage 4: Validation

| Step | What | Service / File |
|------|------|----------------|
| 4.1 | Output equivalence test runner | `outputEquivalenceService.ts` |
| 4.2 | Evidence report generator | `equivalenceReportService.ts` |

---

### Phase 5 -- Stage 5: Cutover

| Step | What | Service / File |
|------|------|----------------|
| 5.1 | Compliance report generator | `complianceReportGenerator.ts` |
| 5.2 | Parallel run monitor | `parallelRunMonitor.ts` |
| 5.3 | Rollback service | `rollbackService.ts` |

---

### Phase 6 -- Power Mode Integration

| Step | What |
|------|------|
| 6.1 | Register `/modernise` command in Power Mode |
| 6.2 | Power Mode session spawns modernisation agent for batch translation runs |
| 6.3 | Power Bus integration for cross-service coordination |

---

## Key Commands

| Command | Description |
|---------|-------------|
| `neuralInverse.openModernisation` | Open the modernisation console (Cmd+Alt+M) |
| `neuralInverse.modernisation.startDiscovery` | Run Stage 1 discovery on workspace |
| `neuralInverse.modernisation.openRoadmap` | Open Stage 2 planning view |
| `neuralInverse.modernisation.openSession` | Open two-window migration session for selected unit |
| `neuralInverse.modernisation.approveUnit` | Approve current unit and advance to next |
| `neuralInverse.modernisation.blockUnit` | Block unit and flag for compliance review |
| `neuralInverse.modernisation.runEquivalenceTest` | Trigger Stage 4 output equivalence test |
| `neuralInverse.modernisation.generateReport` | Generate Stage 5 compliance audit package |
| `neuralInverse.endModernisationSession` | End the current modernisation session |
