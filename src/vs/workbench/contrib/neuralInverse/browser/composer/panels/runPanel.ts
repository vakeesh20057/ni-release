/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { IAgentRun, IStepRun, StepRunStatus } from '../../../common/workflowTypes.js';

export class RunPanel extends Disposable {

	private _container: HTMLElement | null = null;
	private _stepsContainer: HTMLElement | null = null;
	private _headerEl: HTMLElement | null = null;
	private _timerEl: HTMLElement | null = null;
	private _cancelBtn: HTMLElement | null = null;
	private _currentRun: IAgentRun | null = null;
	private _timerInterval: ReturnType<typeof setInterval> | null = null;
	private _expanded = new Set<string>();

	private readonly _onCancel = this._register(new Emitter<string>());
	readonly onCancel: Event<string> = this._onCancel.event;

	private readonly _onStepClick = this._register(new Emitter<string>());
	readonly onStepClick: Event<string> = this._onStepClick.event;

	mount(container: HTMLElement): void {
		this._container = container;
		container.style.display = 'none';
		container.style.flexDirection = 'column';
		container.style.borderTop = '1px solid #333';
		container.style.backgroundColor = '#1a1a1a';
		container.style.maxHeight = '250px';
		container.style.overflow = 'hidden';

		const header = document.createElement('div');
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.padding = '8px 12px';
		header.style.borderBottom = '1px solid #2a2a2a';
		header.style.flexShrink = '0';

		this._headerEl = document.createElement('div');
		this._headerEl.style.fontSize = '12px';
		this._headerEl.style.fontWeight = '600';
		this._headerEl.style.color = '#ccc';
		header.appendChild(this._headerEl);

		const rightGroup = document.createElement('div');
		rightGroup.style.display = 'flex';
		rightGroup.style.alignItems = 'center';
		rightGroup.style.gap = '12px';

		this._timerEl = document.createElement('div');
		this._timerEl.style.fontSize = '11px';
		this._timerEl.style.color = '#888';
		this._timerEl.style.fontFamily = 'monospace';
		rightGroup.appendChild(this._timerEl);

		this._cancelBtn = document.createElement('button');
		this._cancelBtn.textContent = 'Cancel';
		this._cancelBtn.style.padding = '4px 10px';
		this._cancelBtn.style.border = '1px solid #e85c5c';
		this._cancelBtn.style.borderRadius = '3px';
		this._cancelBtn.style.backgroundColor = 'transparent';
		this._cancelBtn.style.color = '#e85c5c';
		this._cancelBtn.style.fontSize = '11px';
		this._cancelBtn.style.cursor = 'pointer';
		this._cancelBtn.addEventListener('click', () => {
			if (this._currentRun) { this._onCancel.fire(this._currentRun.id); }
		});
		rightGroup.appendChild(this._cancelBtn);

		header.appendChild(rightGroup);
		container.appendChild(header);

		this._stepsContainer = document.createElement('div');
		this._stepsContainer.style.flex = '1';
		this._stepsContainer.style.overflowY = 'auto';
		this._stepsContainer.style.padding = '8px 12px';
		container.appendChild(this._stepsContainer);
	}

	show(run: IAgentRun): void {
		this._currentRun = run;
		this._expanded.clear();
		if (this._container) { this._container.style.display = 'flex'; }
		this._startTimer();
		this._render();
	}

	update(run: IAgentRun): void {
		this._currentRun = run;
		this._render();

		if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
			this._stopTimer();
			if (this._cancelBtn) { this._cancelBtn.style.display = 'none'; }
		}
	}

	hide(): void {
		if (this._container) { this._container.style.display = 'none'; }
		this._stopTimer();
		this._currentRun = null;
	}

	destroy(): void {
		this._stopTimer();
		if (this._container) { this._container.innerHTML = ''; }
		this._container = null;
	}

	private _render(): void {
		if (!this._currentRun || !this._stepsContainer || !this._headerEl) { return; }

		const run = this._currentRun;
		this._headerEl.textContent = `Run: ${run.workflowName}`;
		this._headerEl.style.color = this._statusColor(run.status);

		this._stepsContainer.innerHTML = '';

		for (const step of run.steps) {
			const stepEl = this._createStepElement(step);
			this._stepsContainer.appendChild(stepEl);
		}

		if (run.error) {
			const errorEl = document.createElement('div');
			errorEl.style.marginTop = '8px';
			errorEl.style.padding = '8px';
			errorEl.style.backgroundColor = 'rgba(232, 92, 92, 0.1)';
			errorEl.style.border = '1px solid #e85c5c';
			errorEl.style.borderRadius = '4px';
			errorEl.style.fontSize = '11px';
			errorEl.style.color = '#e85c5c';
			errorEl.style.fontFamily = 'monospace';
			errorEl.style.whiteSpace = 'pre-wrap';
			errorEl.textContent = run.error;
			this._stepsContainer.appendChild(errorEl);
		}
	}

	private _createStepElement(step: IStepRun): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.style.marginBottom = '4px';

		const header = document.createElement('div');
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.gap = '8px';
		header.style.padding = '6px 8px';
		header.style.borderRadius = '3px';
		header.style.cursor = 'pointer';
		header.style.transition = 'background-color 0.1s';
		header.addEventListener('mouseenter', () => { header.style.backgroundColor = '#252525'; });
		header.addEventListener('mouseleave', () => { header.style.backgroundColor = 'transparent'; });
		header.addEventListener('click', () => {
			if (this._expanded.has(step.stepId)) {
				this._expanded.delete(step.stepId);
			} else {
				this._expanded.add(step.stepId);
			}
			this._render();
			this._onStepClick.fire(step.stepId);
		});

		const statusDot = document.createElement('div');
		statusDot.style.width = '8px';
		statusDot.style.height = '8px';
		statusDot.style.borderRadius = '50%';
		statusDot.style.backgroundColor = this._stepStatusColor(step.status);
		statusDot.style.flexShrink = '0';
		if (step.status === 'running') {
			statusDot.style.animation = 'pulse 1s infinite';
		}
		header.appendChild(statusDot);

		const nameEl = document.createElement('div');
		nameEl.style.fontSize = '12px';
		nameEl.style.color = '#ccc';
		nameEl.style.flex = '1';
		nameEl.textContent = `${step.role} (${step.agentId})`;
		header.appendChild(nameEl);

		if (step.startedAt) {
			const durationEl = document.createElement('div');
			durationEl.style.fontSize = '10px';
			durationEl.style.color = '#666';
			durationEl.style.fontFamily = 'monospace';
			const end = step.endedAt || Date.now();
			durationEl.textContent = this._formatDuration(end - step.startedAt);
			header.appendChild(durationEl);
		}

		const iterEl = document.createElement('div');
		iterEl.style.fontSize = '10px';
		iterEl.style.color = '#555';
		iterEl.textContent = `${step.iterationsUsed} iter`;
		header.appendChild(iterEl);

		wrapper.appendChild(header);

		if (this._expanded.has(step.stepId)) {
			const details = document.createElement('div');
			details.style.padding = '6px 8px 6px 24px';
			details.style.borderLeft = '2px solid #333';
			details.style.marginLeft = '12px';

			if (step.toolCalls.length > 0) {
				const toolHeader = document.createElement('div');
				toolHeader.textContent = `Tool calls (${step.toolCalls.length})`;
				toolHeader.style.fontSize = '10px';
				toolHeader.style.color = '#888';
				toolHeader.style.marginBottom = '4px';
				details.appendChild(toolHeader);

				const maxShow = 5;
				const toShow = step.toolCalls.slice(-maxShow);
				for (const call of toShow) {
					const callEl = document.createElement('div');
					callEl.style.fontSize = '10px';
					callEl.style.color = '#aaa';
					callEl.style.fontFamily = 'monospace';
					callEl.style.marginBottom = '2px';
					callEl.textContent = `${call.toolName}(${Object.keys(call.args).join(', ')}) -> ${call.result.success ? 'ok' : 'err'} [${call.durationMs}ms]`;
					details.appendChild(callEl);
				}
				if (step.toolCalls.length > maxShow) {
					const more = document.createElement('div');
					more.textContent = `... and ${step.toolCalls.length - maxShow} more`;
					more.style.fontSize = '10px';
					more.style.color = '#666';
					details.appendChild(more);
				}
			}

			if (step.outputLog.length > 0) {
				const outputHeader = document.createElement('div');
				outputHeader.textContent = 'Output';
				outputHeader.style.fontSize = '10px';
				outputHeader.style.color = '#888';
				outputHeader.style.marginTop = '8px';
				outputHeader.style.marginBottom = '4px';
				details.appendChild(outputHeader);

				const outputBox = document.createElement('pre');
				outputBox.style.fontSize = '10px';
				outputBox.style.color = '#bbb';
				outputBox.style.backgroundColor = '#1e1e1e';
				outputBox.style.padding = '6px';
				outputBox.style.borderRadius = '3px';
				outputBox.style.maxHeight = '80px';
				outputBox.style.overflow = 'auto';
				outputBox.style.whiteSpace = 'pre-wrap';
				outputBox.style.margin = '0';
				outputBox.textContent = step.outputLog.slice(-20).join('\n');
				details.appendChild(outputBox);
			}

			if (step.error) {
				const errEl = document.createElement('div');
				errEl.style.marginTop = '6px';
				errEl.style.fontSize = '10px';
				errEl.style.color = '#e85c5c';
				errEl.style.fontFamily = 'monospace';
				errEl.textContent = step.error;
				details.appendChild(errEl);
			}

			wrapper.appendChild(details);
		}

		return wrapper;
	}

	private _startTimer(): void {
		this._stopTimer();
		this._updateTimer();
		this._timerInterval = setInterval(() => this._updateTimer(), 1000);
	}

	private _stopTimer(): void {
		if (this._timerInterval) {
			clearInterval(this._timerInterval);
			this._timerInterval = null;
		}
	}

	private _updateTimer(): void {
		if (!this._timerEl || !this._currentRun) { return; }
		const end = this._currentRun.endedAt || Date.now();
		const elapsed = end - this._currentRun.startedAt;
		this._timerEl.textContent = this._formatDuration(elapsed);
	}

	private _formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		if (minutes > 0) {
			return `${minutes}m ${secs}s`;
		}
		return `${secs}s`;
	}

	private _statusColor(status: string): string {
		switch (status) {
			case 'running': case 'planning': return '#e0a84e';
			case 'done': return '#4ec96e';
			case 'failed': return '#e85c5c';
			case 'cancelled': return '#888';
			default: return '#ccc';
		}
	}

	private _stepStatusColor(status: StepRunStatus): string {
		switch (status) {
			case 'running': return '#e0a84e';
			case 'done': return '#4ec96e';
			case 'failed': return '#e85c5c';
			case 'skipped': return '#666';
			case 'pending': return '#444';
			default: return '#444';
		}
	}
}
