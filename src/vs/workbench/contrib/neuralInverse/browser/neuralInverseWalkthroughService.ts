/*---------------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { getActiveWindow } from '../../../../base/browser/dom.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { isMacintosh } from '../../../../base/common/platform.js';

interface IWalkthroughStep {
	id: string;
	icon: string;
	title: string;
	description: string;
	detail: string;
	actionLabel: string;
	actionCommand: string;
}

const STEPS: IWalkthroughStep[] = [
	{
		id: 'llm',
		icon: '🔑',
		title: 'Connect your AI model',
		description: 'Bring Your Own LLM — no vendor lock-in.',
		detail: `
			<h3>Connect your AI model</h3>
			<p>Neural Inverse works with any AI provider. Add cloud API keys or run a fully local model — your choice.</p>
			<div class="ni-wt-cards">
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">☁️ Cloud Providers</div>
					<div class="ni-wt-card-body">Anthropic Claude, OpenAI GPT-4, Google Gemini, DeepSeek, OpenRouter. Paste your API key and start immediately.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🔒 Local &amp; Private</div>
					<div class="ni-wt-card-body">Ollama, vLLM, LM Studio, or any OpenAI-compatible endpoint. Your code never leaves your machine.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🚀 Enterprise Cloud Deploy</div>
					<div class="ni-wt-card-body">Deploy managed model instances on AWS, Azure, or GCP via Agent Manager → Models tab.</div>
				</div>
			</div>
		`,
		actionLabel: 'Open AI Provider Settings',
		actionCommand: 'void.settingsAction',
	},
	{
		id: 'chat',
		icon: '💬',
		title: 'Chat & Power Mode',
		description: 'Two modes — conversation or full agentic execution.',
		detail: `
			<h3>Chat &amp; Power Mode</h3>
			<p>Two interaction modes designed for different workflows.</p>
			<div class="ni-wt-cards">
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">💬 Chat <span class="ni-wt-shortcut">${isMacintosh ? '⌘L' : 'Ctrl+L'}</span></div>
					<div class="ni-wt-card-body">Ask anything, reference files with <code>@</code>, browse past threads. Context-aware across your entire workspace.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">⚡ Power Mode <span class="ni-wt-shortcut">${isMacintosh ? '⌘P' : 'Ctrl+P'}</span></div>
					<div class="ni-wt-card-body">Full agentic loop with tool calling — edit files, run terminals, call HTTP endpoints, query Git. Real-time tool-call rendering with amber highlights.</div>
				</div>
			</div>
		`,
		actionLabel: 'Open Chat',
		actionCommand: 'void.ctrlLAction',
	},
	{
		id: 'agents',
		icon: '🤖',
		title: 'Agentic Mode & Sub-Agents',
		description: 'Orchestrate concurrent agents across your project.',
		detail: `
			<h3>Agentic Mode &amp; Sub-Agents</h3>
			<p>Launch multiple agents simultaneously, each with a scoped role and whitelisted toolset.</p>
			<div class="ni-wt-cards">
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🗂 Agent Manager <span class="ni-wt-shortcut">${isMacintosh ? '⌥⌘A' : 'Ctrl+Alt+A'}</span></div>
					<div class="ni-wt-card-body">Central hub for all running agents. View chat history, tool calls, and live status.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🔀 Sub-Agent Roles</div>
					<div class="ni-wt-card-body"><strong>Explorer</strong> (read-only analysis) · <strong>Editor</strong> (scoped writes) · <strong>Verifier</strong> (tests &amp; lint). Configure concurrency and iteration limits.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">⚙️ .neuralinverseagent</div>
					<div class="ni-wt-card-body">Drop a <code>.neuralinverseagent</code> JSON file in your workspace root to override agent tiers, block commands, and set limits per project.</div>
				</div>
			</div>
		`,
		actionLabel: 'Open Agent Manager',
		actionCommand: 'neuralInverse.openAgentManager',
	},
	{
		id: 'modernisation',
		icon: '🏗',
		title: 'Modernisation Engine',
		description: 'AI-assisted legacy code migration with CPM scheduling.',
		detail: `
			<h3>Modernisation Engine</h3>
			<p>End-to-end migration of legacy codebases — COBOL → Java, PL/SQL → TypeScript, Angular 1 → 18, and 30+ more patterns.</p>
			<div class="ni-wt-cards">
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">📋 5-Stage Pipeline</div>
					<div class="ni-wt-card-body"><strong>Discovery</strong> → <strong>Resolution</strong> → <strong>Fingerprint</strong> → <strong>Translation</strong> → <strong>Cutover</strong>. Migration is stage-gated — locked until your plan is approved.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🗓 CPM Scheduling</div>
					<div class="ni-wt-card-body">Critical-path scheduling with 12 blocker types, API compatibility gates, and compliance ordering. AI-generated roadmap with phase estimates.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🔗 Multi-Project Topology <span class="ni-wt-shortcut">${isMacintosh ? '⌥⌘M' : 'Ctrl+Alt+M'}</span></div>
					<div class="ni-wt-card-body">One-to-one, one-to-many, or flexible source/target project pairings. Opens as a dedicated aux window.</div>
				</div>
			</div>
		`,
		actionLabel: 'Open Modernisation',
		actionCommand: 'neuralInverse.openModernisation',
	},
	{
		id: 'firmware',
		icon: '⚡',
		title: 'Firmware & Safety-Critical',
		description: 'Embedded, automotive, energy, and IIoT/OT support.',
		detail: `
			<h3>Firmware &amp; Safety-Critical</h3>
			<p>First-class support for embedded and industrial systems with industry-specific compliance frameworks built in.</p>
			<div class="ni-wt-cards">
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🔧 Languages &amp; Toolchains</div>
					<div class="ni-wt-card-body">Embedded C/C++, Assembler, AUTOSAR ARXML, CAN DBC, IEC 61131 (Structured Text), TTCN-3. Build system detection: Keil MDK, IAR, PlatformIO, ESP-IDF, CoDeSys.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🛡 Safety Standards</div>
					<div class="ni-wt-card-body">ISO 26262 (ASIL-D), IEC 61508 (SIL), IEC 62443, IEC 61850, MISRA-C, 3GPP, GSMA. Detects ISR re-entrance, watchdog gaps, unsafe pointers, E2E protection gaps.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">⚡ Firmware Modernisation <span class="ni-wt-shortcut">${isMacintosh ? '⌥⌘F' : 'Ctrl+Alt+F'}</span></div>
					<div class="ni-wt-card-body">Migrate legacy BSPs, AUTOSAR classic → adaptive, FreeRTOS → Zephyr. ASIL decomposition enforced at every stage gate.</div>
				</div>
			</div>
		`,
		actionLabel: 'Open Firmware',
		actionCommand: 'neuralInverse.openFirmware',
	},
	{
		id: 'checks',
		icon: '🛡',
		title: 'GRC Checks & Compliance',
		description: 'Real-time compliance scanning as you write code.',
		detail: `
			<h3>GRC Checks &amp; Compliance</h3>
			<p>Neural Inverse checks your codebase against compliance frameworks in real time — no separate CI step needed.</p>
			<div class="ni-wt-cards">
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">🔴 Blocking Violations</div>
					<div class="ni-wt-card-body">Hard stops gating code merge — ASIL-D violations, unsafe pointer arithmetic, ISR re-entrance, missing E2E protection profiles.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">⊗ Checks Agent</div>
					<div class="ni-wt-card-body">Ask about any violation in natural language. 10 built-in GRC tools: <code>get_violations</code>, <code>explain_violation</code>, <code>draft_rule</code>, <code>run_workspace_scan</code>, <code>get_impact_chain</code>.</div>
				</div>
				<div class="ni-wt-card">
					<div class="ni-wt-card-title">📐 Nano Agents</div>
					<div class="ni-wt-card-body">LSP, AST, call hierarchy, and metrics analysis run locally — no LLM calls for static checks. LLM only used for complex rule reasoning.</div>
				</div>
			</div>
		`,
		actionLabel: 'Run Workspace Scan',
		actionCommand: 'neuralInverseChecks.runWorkspaceScan',
	},
];

const STYLES = `
.ni-walkthrough-overlay {
	position: fixed;
	inset: 0;
	z-index: 99999;
	background: rgba(0,0,0,0.75);
	display: flex;
	align-items: center;
	justify-content: center;
	font-family: var(--vscode-font-family);
	animation: ni-wt-fadein 0.2s ease;
}
@keyframes ni-wt-fadein {
	from { opacity: 0; }
	to   { opacity: 1; }
}
.ni-walkthrough-shell {
	display: flex;
	width: min(900px, 92vw);
	height: min(580px, 88vh);
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-panel-border);
	border-radius: 10px;
	overflow: hidden;
	box-shadow: 0 24px 64px rgba(0,0,0,0.6);
}
.ni-wt-sidebar {
	width: 220px;
	flex-shrink: 0;
	border-right: 1px solid var(--vscode-panel-border);
	background: var(--vscode-sideBar-background, var(--vscode-editor-background));
	display: flex;
	flex-direction: column;
	overflow-y: auto;
}
.ni-wt-sidebar-header {
	padding: 18px 16px 12px;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--vscode-descriptionForeground);
	user-select: none;
}
.ni-wt-step-item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 9px 16px;
	cursor: pointer;
	border-left: 2px solid transparent;
	transition: background 0.1s;
	user-select: none;
}
.ni-wt-step-item:hover {
	background: var(--vscode-list-hoverBackground);
}
.ni-wt-step-item.active {
	background: var(--vscode-list-activeSelectionBackground);
	border-left-color: var(--vscode-focusBorder, #007acc);
}
.ni-wt-step-icon {
	font-size: 16px;
	width: 22px;
	text-align: center;
	flex-shrink: 0;
}
.ni-wt-step-label {
	font-size: 12px;
	color: var(--vscode-foreground);
	line-height: 1.35;
}
.ni-wt-step-item.active .ni-wt-step-label {
	color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
}
.ni-wt-step-check {
	margin-left: auto;
	font-size: 12px;
	color: var(--vscode-terminal-ansiGreen, #4ec9b0);
	flex-shrink: 0;
}
.ni-wt-main {
	flex: 1;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.ni-wt-topbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 20px;
	border-bottom: 1px solid var(--vscode-panel-border);
	flex-shrink: 0;
}
.ni-wt-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--vscode-foreground);
}
.ni-wt-close {
	background: none;
	border: none;
	color: var(--vscode-foreground);
	opacity: 0.5;
	cursor: pointer;
	font-size: 18px;
	line-height: 1;
	padding: 2px 6px;
	border-radius: 4px;
}
.ni-wt-close:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
.ni-wt-content {
	flex: 1;
	padding: 24px 28px;
	overflow-y: auto;
	color: var(--vscode-foreground);
}
.ni-wt-content h3 {
	margin: 0 0 10px;
	font-size: 18px;
	font-weight: 600;
}
.ni-wt-content p {
	margin: 0 0 18px;
	font-size: 13px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.6;
}
.ni-wt-cards {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.ni-wt-card {
	border: 1px solid var(--vscode-panel-border);
	border-radius: 6px;
	padding: 12px 14px;
}
.ni-wt-card-title {
	font-size: 12px;
	font-weight: 600;
	margin-bottom: 4px;
	display: flex;
	align-items: center;
	gap: 6px;
}
.ni-wt-card-body {
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.5;
}
.ni-wt-card-body code {
	background: var(--vscode-textCodeBlock-background);
	padding: 1px 4px;
	border-radius: 3px;
	font-family: var(--vscode-editor-font-family);
	font-size: 11px;
}
.ni-wt-shortcut {
	font-weight: 400;
	opacity: 0.55;
	font-size: 11px;
}
.ni-wt-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 20px;
	border-top: 1px solid var(--vscode-panel-border);
	flex-shrink: 0;
}
.ni-wt-progress {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
}
.ni-wt-nav {
	display: flex;
	gap: 8px;
	align-items: center;
}
.ni-wt-btn {
	padding: 5px 14px;
	border-radius: 4px;
	font-size: 12px;
	cursor: pointer;
	border: 1px solid var(--vscode-button-border, transparent);
}
.ni-wt-btn-secondary {
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
}
.ni-wt-btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.ni-wt-btn-primary {
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
}
.ni-wt-btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.ni-wt-btn-action {
	background: none;
	color: var(--vscode-textLink-foreground, #3794ff);
	border: 1px solid var(--vscode-textLink-foreground, #3794ff);
	padding: 4px 12px;
	border-radius: 4px;
	font-size: 12px;
	cursor: pointer;
}
.ni-wt-btn-action:hover { opacity: 0.8; }
`;

export class NeuralInverseWalkthroughService extends Disposable {

	private _overlay: HTMLElement | null = null;
	private _currentStep = 0;
	private _completed = new Set<number>();
	private _stepItems: HTMLElement[] = [];
	private _detailPane: HTMLElement | null = null;
	private _progressEl: HTMLElement | null = null;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
	}

	open(): void {
		if (this._overlay) {
			this._overlay.style.display = 'flex';
			return;
		}
		this._mount();
	}

	private _mount(): void {
		const win = getActiveWindow();
		const doc = win.document;

		// Inject styles once
		if (!doc.getElementById('ni-walkthrough-styles')) {
			const style = doc.createElement('style');
			style.id = 'ni-walkthrough-styles';
			style.textContent = STYLES;
			doc.head.appendChild(style);
		}

		// Overlay backdrop
		const overlay = doc.createElement('div');
		overlay.className = 'ni-walkthrough-overlay';
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) this._close();
		});
		this._overlay = overlay;

		// Shell
		const shell = doc.createElement('div');
		shell.className = 'ni-walkthrough-shell';
		overlay.appendChild(shell);

		// --- Sidebar ---
		const sidebar = doc.createElement('div');
		sidebar.className = 'ni-wt-sidebar';
		shell.appendChild(sidebar);

		const sidebarHeader = doc.createElement('div');
		sidebarHeader.className = 'ni-wt-sidebar-header';
		sidebarHeader.textContent = 'Get Started';
		sidebar.appendChild(sidebarHeader);

		this._stepItems = STEPS.map((step, i) => {
			const item = doc.createElement('div');
			item.className = 'ni-wt-step-item' + (i === 0 ? ' active' : '');
			item.addEventListener('click', () => this._goTo(i));

			const icon = doc.createElement('span');
			icon.className = 'ni-wt-step-icon';
			icon.textContent = step.icon;

			const label = doc.createElement('span');
			label.className = 'ni-wt-step-label';
			label.textContent = step.title;

			item.appendChild(icon);
			item.appendChild(label);
			sidebar.appendChild(item);
			return item;
		});

		// --- Main area ---
		const main = doc.createElement('div');
		main.className = 'ni-wt-main';
		shell.appendChild(main);

		// Top bar
		const topbar = doc.createElement('div');
		topbar.className = 'ni-wt-topbar';
		main.appendChild(topbar);

		const title = doc.createElement('div');
		title.className = 'ni-wt-title';
		title.textContent = 'Neural Inverse — Interactive Tour';
		topbar.appendChild(title);

		const closeBtn = doc.createElement('button');
		closeBtn.className = 'ni-wt-close';
		closeBtn.textContent = '×';
		closeBtn.title = 'Close (Esc)';
		closeBtn.addEventListener('click', () => this._close());
		topbar.appendChild(closeBtn);

		// Detail pane
		const content = doc.createElement('div');
		content.className = 'ni-wt-content';
		main.appendChild(content);
		this._detailPane = content;

		// Footer
		const footer = doc.createElement('div');
		footer.className = 'ni-wt-footer';
		main.appendChild(footer);

		const progress = doc.createElement('span');
		progress.className = 'ni-wt-progress';
		footer.appendChild(progress);
		this._progressEl = progress;

		const nav = doc.createElement('div');
		nav.className = 'ni-wt-nav';
		footer.appendChild(nav);

		const prevBtn = doc.createElement('button');
		prevBtn.className = 'ni-wt-btn ni-wt-btn-secondary';
		prevBtn.textContent = '← Previous';
		prevBtn.addEventListener('click', () => this._goTo(this._currentStep - 1));
		nav.appendChild(prevBtn);

		const nextBtn = doc.createElement('button');
		nextBtn.className = 'ni-wt-btn ni-wt-btn-primary';
		nextBtn.textContent = 'Next →';
		nextBtn.addEventListener('click', () => {
			if (this._currentStep === STEPS.length - 1) {
				this._close();
			} else {
				this._goTo(this._currentStep + 1);
			}
		});
		nav.appendChild(nextBtn);

		// Keyboard handler
		const keyHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { this._close(); }
			if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { this._goTo(this._currentStep + 1); }
			if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { this._goTo(this._currentStep - 1); }
		};
		doc.addEventListener('keydown', keyHandler);
		this._register({ dispose: () => doc.removeEventListener('keydown', keyHandler) });

		doc.body.appendChild(overlay);
		this._register({ dispose: () => overlay.remove() });

		this._renderStep(0);
	}

	private _goTo(index: number): void {
		if (index < 0 || index >= STEPS.length) { return; }
		this._completed.add(this._currentStep);
		this._currentStep = index;
		this._renderStep(index);
	}

	private _renderStep(index: number): void {
		const step = STEPS[index];
		if (!step || !this._detailPane) { return; }

		// Update sidebar
		this._stepItems.forEach((item, i) => {
			item.classList.toggle('active', i === index);
			// Add check mark for completed steps (except current)
			const existing = item.querySelector('.ni-wt-step-check');
			if (existing) { existing.remove(); }
			if (this._completed.has(i) && i !== index) {
				const check = item.ownerDocument.createElement('span');
				check.className = 'ni-wt-step-check';
				check.textContent = '✓';
				item.appendChild(check);
			}
		});

		// Render detail
		const actionBtn = `<button class="ni-wt-btn-action" id="ni-wt-action-btn">${step.actionLabel}</button>`;
		this._detailPane.innerHTML = step.detail + `<div style="margin-top:16px;">${actionBtn}</div>`;

		const btn = this._detailPane.querySelector('#ni-wt-action-btn') as HTMLButtonElement | null;
		if (btn) {
			btn.addEventListener('click', () => {
				this.commandService.executeCommand(step.actionCommand);
				this._completed.add(index);
				this._renderStep(index); // refresh checkmark
			});
		}

		// Update progress
		if (this._progressEl) {
			this._progressEl.textContent = `Step ${index + 1} of ${STEPS.length}`;
		}

		// Update next button label
		const footer = this._overlay?.querySelector('.ni-wt-footer');
		if (footer) {
			const nextBtn = footer.querySelectorAll('.ni-wt-btn')[1] as HTMLButtonElement | null;
			if (nextBtn) {
				nextBtn.textContent = index === STEPS.length - 1 ? 'Done ✓' : 'Next →';
			}
		}
	}

	private _close(): void {
		if (this._overlay) {
			this._overlay.style.display = 'none';
		}
	}
}
