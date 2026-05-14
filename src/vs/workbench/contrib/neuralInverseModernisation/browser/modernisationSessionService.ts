/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ModernisationSessionService
 *
 * Single source of truth for the active modernisation session.
 * Tracks which folders are connected, the current workflow stage,
 * and the file pair selected for compliance analysis.
 *
 * Consumed by:
 *  - ModernisationPart (Compliance Center aux window)
 *  - ModernisationWorkflowViewPane (sidebar panel)
 *  - ModernisationStatusContribution (statusbar item)
 *  - neuralInverseModernisation.contribution (command handler)
 */

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IModernisationProjectFile, MODERNISATION_INVERSE_FILENAME } from '../common/modernisationTypes.js';
import { IMetricsService } from '../../void/common/metricsService.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModernisationStage = 'discovery' | 'planning' | 'migration' | 'validation' | 'cutover';

export const STAGE_LABELS: Record<ModernisationStage, string> = {
	discovery:  '1. Discovery',
	planning:   '2. Planning',
	migration:  '3. Migration',
	validation: '4. Validation',
	cutover:    '5. Cutover',
};

export const STAGES: ModernisationStage[] = ['discovery', 'planning', 'migration', 'validation', 'cutover'];

/**
 * Migration pattern — open string, not a fixed enum.
 * Preset suggestions are in MIGRATION_PATTERN_PRESETS (data-driven).
 * Users can type any free-form pattern name for a custom migration.
 */
export type MigrationPattern = string;

/**
 * Topology of a migration pattern — defines how many source and target
 * projects are involved.
 *
 *  'one'      — exactly one project on this side
 *  'many'     — user defines N ≥ 1 projects on this side
 *  'flexible' — 1 or more; user decides
 */
export interface IPatternTopology {
	sourceCount: 'one' | 'many' | 'flexible';
	targetCount: 'one' | 'many' | 'flexible';
	/** Default label for a source project in this topology */
	sourceLabel: string;
	/** Default label for a target project in this topology */
	targetLabel: string;
}

export interface IMigrationPatternPreset {
	id: string;
	label: string;
	description: string;
	category: string;
	topology: IPatternTopology;
}

/**
 * A single project within a session — either a source (legacy/input)
 * or a target (modern/output).
 */
export interface IProjectTarget {
	/** Stable id, generated once when the project is added */
	id: string;
	role: 'source' | 'target';
	/** User-defined label, e.g. "Legacy Monolith", "PaymentService" */
	label: string;
	folderUri: string;
}

// Topology shorthands
const T_ONE_ONE:   IPatternTopology = { sourceCount: 'one',      targetCount: 'one',      sourceLabel: 'Source Project',  targetLabel: 'Target Project' };
const T_ONE_MANY:  IPatternTopology = { sourceCount: 'one',      targetCount: 'many',     sourceLabel: 'Source Project',  targetLabel: 'Target Service' };
const T_MANY_ONE:  IPatternTopology = { sourceCount: 'many',     targetCount: 'one',      sourceLabel: 'Source Service',  targetLabel: 'Target Project' };
const T_MANY_MANY: IPatternTopology = { sourceCount: 'many',     targetCount: 'many',     sourceLabel: 'Source Service',  targetLabel: 'Target Service' };
const T_FLEX:      IPatternTopology = { sourceCount: 'flexible', targetCount: 'flexible', sourceLabel: 'Source Project',  targetLabel: 'Target Project' };

export const MIGRATION_PATTERN_PRESETS: IMigrationPatternPreset[] = [
	// Structural decomposition
	{ id: 'monolith-to-microservices',    category: 'Structural Decomposition',    label: 'Monolith \u2192 Microservices',       description: 'Decompose a monolithic system into independently deployable, bounded services.',                                         topology: { ...T_ONE_MANY,  sourceLabel: 'Monolith',          targetLabel: 'Microservice' } },
	{ id: 'monolith-to-modular-monolith', category: 'Structural Decomposition',    label: 'Monolith \u2192 Modular Monolith',    description: 'Restructure a monolith into well-defined internal modules without full decomposition.',                               topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy Monolith',   targetLabel: 'Modular Monolith' } },
	{ id: 'monolith-to-serverless',       category: 'Structural Decomposition',    label: 'Monolith \u2192 Serverless',          description: 'Extract functions from a monolith and deploy as serverless handlers.',                                                topology: { ...T_ONE_MANY,  sourceLabel: 'Monolith',          targetLabel: 'Serverless Function' } },
	{ id: 'microservices-to-monolith',    category: 'Structural Decomposition',    label: 'Microservices \u2192 Monolith',       description: 'Consolidate over-split microservices into a cohesive monolith (reverse-decomposition).',                             topology: { ...T_MANY_ONE,  sourceLabel: 'Microservice',      targetLabel: 'Monolith' } },
	{ id: 'microservices-reorganisation', category: 'Structural Decomposition',    label: 'Microservices Re-boundary',           description: 'Redraw service boundaries without changing the overall microservices topology.',                                       topology: { ...T_MANY_MANY, sourceLabel: 'Existing Service',  targetLabel: 'New Service' } },
	// Mainframe & legacy language
	{ id: 'mainframe-to-cloud',           category: 'Mainframe & Legacy Language', label: 'Mainframe \u2192 Cloud',              description: 'Translate COBOL, PL/I, RPG, or Natural to cloud-native equivalents.',                                                topology: { ...T_ONE_ONE,   sourceLabel: 'Mainframe Program', targetLabel: 'Cloud Service' } },
	{ id: 'cobol-replatform',             category: 'Mainframe & Legacy Language', label: 'COBOL Re-platform',                   description: 'Keep COBOL source but migrate runtime, OS, or compiler (e.g., z/OS \u2192 Linux on IBM Z).',                          topology: { ...T_ONE_ONE,   sourceLabel: 'COBOL Program',     targetLabel: 'Re-platformed Program' } },
	{ id: 'cobol-to-java',                category: 'Mainframe & Legacy Language', label: 'COBOL \u2192 Java',                   description: 'Translate COBOL paragraphs and copybooks to Java classes and methods.',                                              topology: { ...T_ONE_ONE,   sourceLabel: 'COBOL Program',     targetLabel: 'Java Project' } },
	{ id: 'cobol-to-typescript',          category: 'Mainframe & Legacy Language', label: 'COBOL \u2192 TypeScript',             description: 'Translate COBOL paragraphs and copybooks to TypeScript modules.',                                                   topology: { ...T_ONE_ONE,   sourceLabel: 'COBOL Program',     targetLabel: 'TypeScript Project' } },
	{ id: 'rpg-modernisation',            category: 'Mainframe & Legacy Language', label: 'RPG Modernisation',                   description: 'Modernise RPG/RPG IV programs to free-format RPG or a modern language.',                                            topology: { ...T_ONE_ONE,   sourceLabel: 'RPG Program',       targetLabel: 'Modern Program' } },
	{ id: 'natural-migration',            category: 'Mainframe & Legacy Language', label: 'Natural Migration',                   description: 'Migrate Software AG Natural / Adabas programs to modern platforms.',                                               topology: { ...T_ONE_ONE,   sourceLabel: 'Natural Program',   targetLabel: 'Modern Project' } },
	{ id: 'pl1-migration',                category: 'Mainframe & Legacy Language', label: 'PL/I Migration',                      description: 'Migrate IBM PL/I programs to Java, C#, or another modern language.',                                               topology: { ...T_ONE_ONE,   sourceLabel: 'PL/I Program',      targetLabel: 'Modern Project' } },
	{ id: 'assembler-modernisation',      category: 'Mainframe & Legacy Language', label: 'Assembler Modernisation',             description: 'Replace mainframe or embedded assembler code with a higher-level language.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'Assembler Program', targetLabel: 'Modern Program' } },
	// Database
	{ id: 'database-modernisation',       category: 'Database',                    label: 'Database Modernisation',              description: 'Replace PL/SQL, T-SQL, or embedded SQL with a modern ORM or service layer.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy Database',   targetLabel: 'Modern Data Layer' } },
	{ id: 'stored-proc-to-service',       category: 'Database',                    label: 'Stored Procs \u2192 Service Layer',   description: 'Extract stored procedure logic into application-layer microservices.',                                              topology: { ...T_ONE_MANY,  sourceLabel: 'Legacy Database',   targetLabel: 'Service' } },
	{ id: 'oracle-to-postgres',           category: 'Database',                    label: 'Oracle \u2192 PostgreSQL',            description: 'Migrate Oracle PL/SQL schemas, procedures, and data to PostgreSQL.',                                               topology: { ...T_ONE_ONE,   sourceLabel: 'Oracle Database',   targetLabel: 'PostgreSQL Database' } },
	{ id: 'db2-migration',                category: 'Database',                    label: 'DB2 Migration',                       description: 'Migrate IBM DB2 schemas, stored procedures, and workloads.',                                                       topology: { ...T_ONE_ONE,   sourceLabel: 'DB2 Database',      targetLabel: 'Modern Database' } },
	{ id: 'sybase-migration',             category: 'Database',                    label: 'Sybase \u2192 Modern DB',             description: 'Migrate Sybase ASE schemas and T-SQL to SQL Server or PostgreSQL.',                                                topology: { ...T_ONE_ONE,   sourceLabel: 'Sybase Database',   targetLabel: 'Modern Database' } },
	// Framework & language
	{ id: 'framework-upgrade',            category: 'Framework & Language',        label: 'Framework Upgrade',                   description: 'Upgrade to a newer version of the same framework (Spring Boot, Angular, .NET, etc.).',                            topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy Project',    targetLabel: 'Upgraded Project' } },
	{ id: 'java-ee-to-jakarta',           category: 'Framework & Language',        label: 'Java EE \u2192 Jakarta EE',           description: 'Migrate Java EE applications to Jakarta EE with updated namespace and APIs.',                                      topology: { ...T_ONE_ONE,   sourceLabel: 'Java EE Project',   targetLabel: 'Jakarta EE Project' } },
	{ id: 'dotnet-framework-to-core',     category: 'Framework & Language',        label: '.NET Framework \u2192 .NET',          description: 'Port .NET Framework applications to .NET 6/8 on Linux/containers.',                                               topology: { ...T_ONE_ONE,   sourceLabel: '.NET Fx Project',   targetLabel: '.NET Project' } },
	{ id: 'angular-js-to-angular',        category: 'Framework & Language',        label: 'AngularJS \u2192 Angular',            description: 'Rewrite AngularJS (1.x) applications in Angular (2+).',                                                           topology: { ...T_ONE_ONE,   sourceLabel: 'AngularJS App',     targetLabel: 'Angular App' } },
	{ id: 'cfc-to-api',                   category: 'Framework & Language',        label: 'ColdFusion \u2192 REST API',          description: 'Replace ColdFusion components with REST APIs and a modern frontend.',                                             topology: { ...T_ONE_ONE,   sourceLabel: 'ColdFusion App',    targetLabel: 'REST API' } },
	{ id: 'struts-migration',             category: 'Framework & Language',        label: 'Struts Migration',                    description: 'Migrate Apache Struts 1/2 applications to Spring MVC or Spring Boot.',                                            topology: { ...T_ONE_ONE,   sourceLabel: 'Struts App',        targetLabel: 'Spring Boot App' } },
	{ id: 'vb6-to-dotnet',               category: 'Framework & Language',        label: 'VB6 \u2192 .NET',                     description: 'Rewrite Visual Basic 6 applications in VB.NET or C#.',                                                            topology: { ...T_ONE_ONE,   sourceLabel: 'VB6 Project',       targetLabel: '.NET Project' } },
	{ id: 'perl-modernisation',           category: 'Framework & Language',        label: 'Perl Modernisation',                  description: 'Replace legacy Perl scripts with Python, Ruby, or Go equivalents.',                                               topology: { ...T_ONE_ONE,   sourceLabel: 'Perl Scripts',      targetLabel: 'Modern Project' } },
	// Architecture style
	{ id: 'soa-to-microservices',         category: 'Architecture Style',          label: 'SOA \u2192 Microservices',            description: 'Decompose SOA / ESB-based services into lightweight, independent microservices.',                                  topology: { ...T_MANY_MANY, sourceLabel: 'SOA Service',       targetLabel: 'Microservice' } },
	{ id: 'event-driven-refactor',        category: 'Architecture Style',          label: 'Event-Driven Refactor',               description: 'Introduce event streaming (Kafka, EventBridge) to decouple synchronous call chains.',                             topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy System',     targetLabel: 'Event-Driven System' } },
	{ id: 'batch-to-streaming',           category: 'Architecture Style',          label: 'Batch \u2192 Streaming',              description: 'Replace scheduled batch jobs with real-time stream processing pipelines.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'Batch System',      targetLabel: 'Streaming System' } },
	{ id: 'api-gateway-consolidation',    category: 'Architecture Style',          label: 'API Gateway Consolidation',           description: 'Consolidate multiple legacy API facades behind a unified modern gateway.',                                        topology: { ...T_MANY_ONE,  sourceLabel: 'Legacy API',        targetLabel: 'API Gateway' } },
	{ id: 'strangler-fig',                category: 'Architecture Style',          label: 'Strangler Fig Pattern',               description: 'Incrementally replace legacy system components by routing traffic to new equivalents.',                            topology: { ...T_ONE_MANY,  sourceLabel: 'Legacy System',     targetLabel: 'New Component' } },
	{ id: 'lift-and-shift',               category: 'Architecture Style',          label: 'Lift & Shift (Rehost)',               description: 'Move the application to a new infrastructure with minimal code changes.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'On-Prem System',    targetLabel: 'Cloud System' } },
	{ id: 'replatform',                   category: 'Architecture Style',          label: 'Re-platform',                         description: 'Migrate to a new runtime or cloud platform with targeted optimisations.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy System',     targetLabel: 'Modern Platform' } },
	// Other
	{ id: 'custom',                       category: 'Other',                       label: 'Custom',                              description: 'Define your own migration scope, unit decomposition, and compliance rules.',                                      topology: T_FLEX },
];

/** Lookup label by pattern id — derived from MIGRATION_PATTERN_PRESETS. */
export const MIGRATION_PATTERN_LABELS: Record<string, string> =
	Object.fromEntries(MIGRATION_PATTERN_PRESETS.map(p => [p.id, p.label]));

/** Lookup description by pattern id — derived from MIGRATION_PATTERN_PRESETS. */
export const MIGRATION_PATTERN_DESCRIPTIONS: Record<string, string> =
	Object.fromEntries(MIGRATION_PATTERN_PRESETS.map(p => [p.id, p.description]));

export interface IModernisationSessionData {
	isActive: boolean;
	/** Stable ID shared with the Modernisation.inverse file — used to key the KB. */
	sessionId?: string;
	/** All source (legacy / input) projects in this session. */
	sources: IProjectTarget[];
	/** All target (modern / output) projects in this session. */
	targets: IProjectTarget[];
	/** File currently selected for compliance analysis on the source side. */
	activeSourceFileUri?: string;
	/** File currently selected for compliance analysis on the target side. */
	activeTargetFileUri?: string;
	currentStage: ModernisationStage;
	migrationPattern?: MigrationPattern;
	/** Whether the Stage 2 (Planning) roadmap has been approved by the user */
	planApproved?: boolean;
	/** Unix ms when the session became active — used for duration telemetry */
	sessionStartedAt?: number;
}

// ─── Service interface ────────────────────────────────────────────────────────

export const IModernisationSessionService = createDecorator<IModernisationSessionService>('modernisationSessionService');

export interface IModernisationSessionService {
	readonly _serviceBrand: undefined;

	/** Current session snapshot. Mutates reactively — listen to onDidChangeSession for updates. */
	readonly session: IModernisationSessionData;

	/** Fires whenever session state changes. */
	readonly onDidChangeSession: Event<IModernisationSessionData>;

	/**
	 * Create a new Modernisation Project:
	 * - Writes `Modernisation.inverse` (v2) to every project root
	 * - Starts the session
	 *
	 * @param sources  One or more source (legacy) projects
	 * @param targets  One or more target (modern) projects
	 * @param pattern  The migration architecture pattern (optional, set later via setMigrationPattern)
	 */
	createProject(
		sources: Array<{ uri: URI; label: string }>,
		targets: Array<{ uri: URI; label: string }>,
		pattern?: MigrationPattern,
	): Promise<void>;

	/**
	 * Read the `Modernisation.inverse` file from a folder and restore the session.
	 * Supports both v1 (legacy/modern pair) and v2 (sources/targets arrays).
	 * Returns false if no valid file is found.
	 */
	openExistingProject(folderUri: URI): Promise<boolean>;

	/**
	 * Start a session directly (no file creation — use createProject for new projects).
	 * Persists to workspace storage and emits onDidChangeSession.
	 */
	startSession(sources: IProjectTarget[], targets: IProjectTarget[], pattern?: MigrationPattern): void;

	/** Advance the workflow to the given stage. */
	setStage(stage: ModernisationStage): void;

	/** Set the active file pair for compliance analysis. */
	setFilePair(sourceFileUri: string | undefined, targetFileUri: string | undefined): void;

	/** Set the migration architecture pattern. */
	setMigrationPattern(pattern: MigrationPattern): void;

	/** Mark the Stage 2 plan as approved by the user — allows Stage 3 to begin. */
	approvePlan(): void;

	/** End the session (clears all state). */
	endSession(): void;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const SESSION_STORAGE_KEY = 'neuralInverseModernisation.session';

// ─── Implementation ───────────────────────────────────────────────────────────

class ModernisationSessionService extends Disposable implements IModernisationSessionService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = this._register(new Emitter<IModernisationSessionData>());
	readonly onDidChangeSession: Event<IModernisationSessionData> = this._onDidChangeSession.event;

	private _session: IModernisationSessionData;

	get session(): IModernisationSessionData { return this._session; }

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IMetricsService private readonly _metricsService: IMetricsService,
	) {
		super();
		this._session = this._load();
		// Initial validation / auto-detection against the current workspace
		this._reconcileWithWorkspace();

		// Re-run every time the workspace folders change (e.g. the user opens a
		// different project in the same window via File > Open Folder).  The service
		// is a singleton and is NOT re-instantiated on workspace switch, so without
		// this listener the in-memory session stays "active" for the new project.
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this._reconcileWithWorkspace();
		}));
	}

	/**
	 * Single reconciliation point — called on startup and whenever the VS Code
	 * workspace folders change (e.g. File > Open Folder replaces the workspace).
	 *
	 * Two cases:
	 *
	 *  A. Session is currently "active" in memory / storage:
	 *     Walk the stored source folders and look for Modernisation.inverse.
	 *     If found → session is legitimate, leave it alone.
	 *     If NOT found → the session belongs to a different project (stale storage
	 *     or workspace switch); clear it so the status bar stays clean.
	 *
	 *  B. Session is NOT active:
	 *     Walk the current workspace root folders and look for Modernisation.inverse.
	 *     If found → auto-restore the session so the badge lights up without the
	 *     user having to manually re-open the modernisation console.
	 */
	private async _reconcileWithWorkspace(): Promise<void> {
		// The canonical check for BOTH cases is the same:
		// look for Modernisation.inverse in the CURRENT workspace root folders.
		//
		// Case A (session active): if the current workspace has no .inverse file
		//   the session belongs to a different project — clear it immediately.
		//   (The stored source folders may legitimately have .inverse, but they
		//   are not this workspace — checking them would give a false positive.)
		//
		// Case B (session not active): if a .inverse file is found, restore it.

		const roots = this.workspaceContextService.getWorkspace().folders;

		for (const folder of roots) {
			try {
				const inverseUri = URI.joinPath(folder.uri, MODERNISATION_INVERSE_FILENAME);
				if (await this.fileService.exists(inverseUri)) {
					// This workspace contains a .inverse file — restore / keep session.
					if (!this._session.isActive) {
						await this.openExistingProject(folder.uri);
					}
					return; // valid
				}
			} catch { /* treat as not found */ }
		}

		// No .inverse file found in any current workspace root.
		// If a session was active it is stale — clear it.
		if (this._session.isActive) {
			this.endSession();
		}
	}

	async createProject(
		rawSources: Array<{ uri: URI; label: string }>,
		rawTargets: Array<{ uri: URI; label: string }>,
		pattern?: MigrationPattern,
	): Promise<void> {
		const sessionId = this._generateId();
		const now = Date.now();

		// Assign stable ids
		const sources: IProjectTarget[] = rawSources.map(s => ({
			id: this._generateId(), role: 'source' as const, label: s.label, folderUri: s.uri.toString(),
		}));
		const targets: IProjectTarget[] = rawTargets.map(t => ({
			id: this._generateId(), role: 'target' as const, label: t.label, folderUri: t.uri.toString(),
		}));

		// Write Modernisation.inverse v2 to every folder
		const writes: Promise<void>[] = [];
		for (const src of sources) {
			const file: IModernisationProjectFile = {
				neuralInverseModernisation: true, version: '2',
				role: 'source', projectLabel: src.label, projectId: src.id,
				pairedProjects: targets.map(t => ({ role: 'target' as const, label: t.label, uri: t.folderUri, id: t.id })),
				migrationPattern: pattern,
				sessionId, createdAt: now,
			};
			writes.push(this.fileService.writeFile(
				URI.joinPath(URI.parse(src.folderUri), MODERNISATION_INVERSE_FILENAME),
				VSBuffer.fromString(JSON.stringify(file, null, '\t')),
			).then(() => undefined));
		}
		for (const tgt of targets) {
			const file: IModernisationProjectFile = {
				neuralInverseModernisation: true, version: '2',
				role: 'target', projectLabel: tgt.label, projectId: tgt.id,
				pairedProjects: sources.map(s => ({ role: 'source' as const, label: s.label, uri: s.folderUri, id: s.id })),
				migrationPattern: pattern,
				sessionId, createdAt: now,
			};
			writes.push(this.fileService.writeFile(
				URI.joinPath(URI.parse(tgt.folderUri), MODERNISATION_INVERSE_FILENAME),
				VSBuffer.fromString(JSON.stringify(file, null, '\t')),
			).then(() => undefined));
		}
		await Promise.all(writes);

		this._metricsService.capture('Modernisation Project Created', {
			migration_pattern: pattern ?? 'none',
			source_count: sources.length,
			target_count: targets.length,
		});
		this.startSession(sources, targets, pattern, sessionId);
	}

	async openExistingProject(folderUri: URI): Promise<boolean> {
		const filePath = URI.joinPath(folderUri, MODERNISATION_INVERSE_FILENAME);
		try {
			const content = await this.fileService.readFile(filePath);
			const data = JSON.parse(content.value.toString()) as Partial<IModernisationProjectFile>;
			if (!data.neuralInverseModernisation) { return false; }

			let sources: IProjectTarget[] = [];
			let targets: IProjectTarget[] = [];

			if (data.version === '2' && data.role && data.projectId && data.pairedProjects) {
				// v2: reconstruct sources[] and targets[] from this file + pairedProjects
				const thisPT: IProjectTarget = {
					id: data.projectId, role: data.role,
					label: data.projectLabel ?? this._basename(folderUri.path),
					folderUri: folderUri.toString(),
				};
				const paired: IProjectTarget[] = data.pairedProjects.map(p => ({
					id: p.id, role: p.role, label: p.label, folderUri: p.uri,
				}));
				if (data.role === 'source') {
					sources = [thisPT];
					targets = paired.filter(p => p.role === 'target');
				} else {
					targets = [thisPT];
					sources = paired.filter(p => p.role === 'source');
				}
			} else if (data.pairedProject?.uri) {
				// v1 backwards compat: legacy → source, modern → target
				// pairedProject.role tells us the OTHER side; if it's 'modern', this file is legacy/source
				const isLegacy = data.pairedProject?.role === 'modern' || (!data.role && !!data.projectName);
				const thisId = this._generateId();
				const pairedId = this._generateId();
				if (isLegacy) {
					sources = [{ id: thisId, role: 'source', label: data.projectName ?? this._basename(folderUri.path), folderUri: folderUri.toString() }];
					targets = [{ id: pairedId, role: 'target', label: data.pairedProject.name ?? 'Modern Project', folderUri: data.pairedProject.uri }];
				} else {
					targets = [{ id: thisId, role: 'target', label: data.projectName ?? this._basename(folderUri.path), folderUri: folderUri.toString() }];
					sources = [{ id: pairedId, role: 'source', label: data.pairedProject.name ?? 'Legacy Project', folderUri: data.pairedProject.uri }];
				}
			} else {
				return false;
			}

			this.startSession(sources, targets, data.migrationPattern, data.sessionId);
			return true;
		} catch {
			return false;
		}
	}

	startSession(sources: IProjectTarget[], targets: IProjectTarget[], pattern?: MigrationPattern, sessionId?: string): void {
		this._mutate({
			isActive: true,
			sessionId,
			sources,
			targets,
			activeSourceFileUri: undefined,
			activeTargetFileUri: undefined,
			currentStage: 'discovery',
			migrationPattern: pattern,
			sessionStartedAt: Date.now(),
		});
	}

	private _generateId(): string {
		return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
	}

	private _basename(path: string): string {
		return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
	}

	setStage(stage: ModernisationStage): void {
		this._metricsService.capture('Modernisation Stage Advanced', {
			from_stage: this._session.currentStage,
			to_stage: stage,
		});
		this._mutate({ ...this._session, currentStage: stage });
	}

	setFilePair(sourceFileUri: string | undefined, targetFileUri: string | undefined): void {
		this._mutate({ ...this._session, activeSourceFileUri: sourceFileUri, activeTargetFileUri: targetFileUri });
	}

	setMigrationPattern(pattern: MigrationPattern): void {
		this._mutate({ ...this._session, migrationPattern: pattern });
	}

	approvePlan(): void {
		this._metricsService.capture('Modernisation Plan Approved', {
			stage: this._session.currentStage,
			migration_pattern: this._session.migrationPattern ?? 'none',
		});
		this._mutate({ ...this._session, planApproved: true });
	}

	endSession(): void {
		this._metricsService.capture('Modernisation Session Ended', {
			final_stage: this._session.currentStage,
			migration_pattern: this._session.migrationPattern ?? 'none',
			plan_approved: this._session.planApproved ?? false,
			duration_ms: this._session.sessionStartedAt ? Date.now() - this._session.sessionStartedAt : 0,
		});
		this._mutate({ isActive: false, sources: [], targets: [], currentStage: 'discovery' });
	}

	private _mutate(next: IModernisationSessionData): void {
		this._session = next;
		this.storageService.store(SESSION_STORAGE_KEY, JSON.stringify(next), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this._onDidChangeSession.fire(next);
	}

	private _load(): IModernisationSessionData {
		const raw = this.storageService.get(SESSION_STORAGE_KEY, StorageScope.WORKSPACE);
		if (raw) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const parsed = JSON.parse(raw) as any;

				// v1 storage migration guard: if old fields are present, convert them
				if (parsed.legacyFolderUri || parsed.modernFolderUri) {
					const sources: IProjectTarget[] = parsed.legacyFolderUri
						? [{ id: this._generateId(), role: 'source', label: this._basename(parsed.legacyFolderUri), folderUri: parsed.legacyFolderUri }]
						: [];
					const targets: IProjectTarget[] = parsed.modernFolderUri
						? [{ id: this._generateId(), role: 'target', label: this._basename(parsed.modernFolderUri), folderUri: parsed.modernFolderUri }]
						: [];
					return {
						isActive: parsed.isActive ?? false,
						sources, targets,
						activeSourceFileUri: parsed.legacyFileUri,
						activeTargetFileUri: parsed.modernFileUri,
						currentStage: parsed.currentStage ?? 'discovery',
						migrationPattern: parsed.migrationPattern,
						planApproved: parsed.planApproved ?? false,
					};
				}

				// v2 storage
				return {
					isActive: parsed.isActive ?? false,
					sessionId: parsed.sessionId,
					sources: parsed.sources ?? [],
					targets: parsed.targets ?? [],
					activeSourceFileUri: parsed.activeSourceFileUri,
					activeTargetFileUri: parsed.activeTargetFileUri,
					currentStage: parsed.currentStage ?? 'discovery',
					migrationPattern: parsed.migrationPattern,
					planApproved: parsed.planApproved ?? false,
				};
			} catch { /* fall through to default */ }
		}
		return { isActive: false, sources: [], targets: [], currentStage: 'discovery' };
	}
}

registerSingleton(IModernisationSessionService, ModernisationSessionService, InstantiationType.Delayed);
