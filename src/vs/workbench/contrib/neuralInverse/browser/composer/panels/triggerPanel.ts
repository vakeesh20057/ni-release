/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';

export interface ITriggerTestResult {
	readonly fired: boolean;
	readonly triggerType: string;
	readonly message: string;
}

const CRON_DESCRIPTIONS: Record<string, string> = {
	'1': 'Every minute',
	'5': 'Every 5 minutes',
	'15': 'Every 15 minutes',
	'30': 'Every 30 minutes',
	'60': 'Every hour',
	'120': 'Every 2 hours',
	'240': 'Every 4 hours',
	'480': 'Every 8 hours',
	'720': 'Every 12 hours',
	'1440': 'Every day'
};

export class TriggerPanel extends Disposable {

	private _container: HTMLElement | null = null;

	private readonly _onTestTrigger = this._register(new Emitter<{ triggerType: string; config: Record<string, unknown> }>());
	readonly onTestTrigger: Event<{ triggerType: string; config: Record<string, unknown> }> = this._onTestTrigger.event;

	mount(container: HTMLElement): void {
		this._container = container;
	}

	renderForConfig(config: Record<string, unknown>): void {
		if (!this._container) { return; }
		this._container.innerHTML = '';

		const triggerType = config['triggerType'] as string;

		const header = document.createElement('div');
		header.style.fontSize = '11px';
		header.style.fontWeight = '600';
		header.style.color = '#888';
		header.style.textTransform = 'uppercase';
		header.style.marginBottom = '12px';
		header.textContent = 'Trigger Details';
		this._container.appendChild(header);

		switch (triggerType) {
			case 'file-save':
				this._renderFileSave(config);
				break;
			case 'on-commit':
				this._renderOnCommit(config);
				break;
			case 'schedule':
				this._renderSchedule(config);
				break;
			case 'terminal-command':
				this._renderTerminalCommand(config);
				break;
			case 'manual':
			default:
				this._renderManual();
				break;
		}

		this._renderTestButton(triggerType, config);
	}

	destroy(): void {
		if (this._container) { this._container.innerHTML = ''; }
		this._container = null;
	}

	private _renderManual(): void {
		if (!this._container) { return; }
		const info = document.createElement('div');
		info.style.fontSize = '12px';
		info.style.color = '#999';
		info.style.padding = '8px 0';
		info.textContent = 'Workflow runs manually via the Run button or programmatic API.';
		this._container.appendChild(info);
	}

	private _renderFileSave(config: Record<string, unknown>): void {
		if (!this._container) { return; }
		const glob = config['glob'] as string;
		const debounce = config['debounceMs'] as number;

		const details = document.createElement('div');
		details.style.fontSize = '12px';
		details.style.color = '#bbb';

		if (glob) {
			const row = this._createDetailRow('Pattern', glob);
			details.appendChild(row);
		} else {
			const row = this._createDetailRow('Pattern', 'All files (no filter)');
			row.style.color = '#e0a84e';
			details.appendChild(row);
		}

		const debounceRow = this._createDetailRow('Debounce', `${debounce || 300}ms`);
		details.appendChild(debounceRow);

		const preview = this._createPreviewBox(
			glob ? `Fires when files matching "${glob}" are saved` : 'Fires on any file save'
		);
		details.appendChild(preview);

		this._container.appendChild(details);
	}

	private _renderOnCommit(config: Record<string, unknown>): void {
		if (!this._container) { return; }
		const branch = config['branchFilter'] as string;
		const pathFilter = config['pathFilter'] as string;

		const details = document.createElement('div');
		details.style.fontSize = '12px';
		details.style.color = '#bbb';

		if (branch) {
			details.appendChild(this._createDetailRow('Branch', branch));
		}
		if (pathFilter) {
			details.appendChild(this._createDetailRow('Paths', pathFilter));
		}

		const conditions: string[] = [];
		if (branch) { conditions.push(`branch matches /${branch}/`); }
		if (pathFilter) { conditions.push(`files match "${pathFilter}"`); }

		const preview = this._createPreviewBox(
			conditions.length > 0
				? `Fires on commit when ${conditions.join(' AND ')}`
				: 'Fires on every commit'
		);
		details.appendChild(preview);

		this._container.appendChild(details);
	}

	private _renderSchedule(config: Record<string, unknown>): void {
		if (!this._container) { return; }
		const minutes = config['scheduleMinutes'] as number || 5;

		const details = document.createElement('div');
		details.style.fontSize = '12px';
		details.style.color = '#bbb';

		details.appendChild(this._createDetailRow('Interval', `${minutes} minutes`));

		const description = CRON_DESCRIPTIONS[String(minutes)] || `Every ${minutes} minutes`;
		const preview = this._createPreviewBox(description);
		details.appendChild(preview);

		this._container.appendChild(details);
	}

	private _renderTerminalCommand(config: Record<string, unknown>): void {
		if (!this._container) { return; }
		const command = config['command'] as string;
		const onExit = config['triggerOnExit'] as string || 'failure';

		const details = document.createElement('div');
		details.style.fontSize = '12px';
		details.style.color = '#bbb';

		if (command) {
			const cmdRow = this._createDetailRow('Command', '');
			const code = document.createElement('code');
			code.textContent = command;
			code.style.backgroundColor = '#2a2a2a';
			code.style.padding = '2px 6px';
			code.style.borderRadius = '3px';
			code.style.fontSize = '11px';
			code.style.fontFamily = 'monospace';
			cmdRow.appendChild(code);
			details.appendChild(cmdRow);
		}

		const exitLabel = onExit === 'failure' ? 'Non-zero exit' :
			onExit === 'success' ? 'Exit code 0' : 'Any exit';
		details.appendChild(this._createDetailRow('Fires on', exitLabel));

		const preview = this._createPreviewBox(
			command
				? `Polls "${command}" and fires on ${exitLabel.toLowerCase()}`
				: 'No command configured'
		);
		details.appendChild(preview);

		this._container.appendChild(details);
	}

	private _renderTestButton(triggerType: string, config: Record<string, unknown>): void {
		if (!this._container) { return; }

		const btnWrapper = document.createElement('div');
		btnWrapper.style.marginTop = '16px';
		btnWrapper.style.paddingTop = '12px';
		btnWrapper.style.borderTop = '1px solid #333';

		const btn = document.createElement('button');
		btn.textContent = 'Test Trigger';
		btn.style.width = '100%';
		btn.style.padding = '8px';
		btn.style.border = '1px solid #555';
		btn.style.borderRadius = '4px';
		btn.style.backgroundColor = '#2a2a2a';
		btn.style.color = '#ddd';
		btn.style.fontSize = '12px';
		btn.style.cursor = 'pointer';
		btn.style.transition = 'background-color 0.1s';
		btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = '#333'; });
		btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = '#2a2a2a'; });
		btn.addEventListener('click', () => {
			this._onTestTrigger.fire({ triggerType, config });
		});

		btnWrapper.appendChild(btn);

		const hint = document.createElement('div');
		hint.textContent = 'Simulates a trigger fire and highlights the execution path';
		hint.style.fontSize = '10px';
		hint.style.color = '#666';
		hint.style.marginTop = '6px';
		hint.style.textAlign = 'center';
		btnWrapper.appendChild(hint);

		this._container.appendChild(btnWrapper);
	}

	private _createDetailRow(label: string, value: string): HTMLElement {
		const row = document.createElement('div');
		row.style.display = 'flex';
		row.style.justifyContent = 'space-between';
		row.style.alignItems = 'center';
		row.style.marginBottom = '6px';
		row.style.padding = '4px 0';

		const labelEl = document.createElement('span');
		labelEl.textContent = label;
		labelEl.style.color = '#888';
		labelEl.style.fontSize = '11px';
		row.appendChild(labelEl);

		if (value) {
			const valueEl = document.createElement('span');
			valueEl.textContent = value;
			valueEl.style.color = '#ddd';
			valueEl.style.fontSize = '11px';
			valueEl.style.fontFamily = 'monospace';
			row.appendChild(valueEl);
		}

		return row;
	}

	private _createPreviewBox(text: string): HTMLElement {
		const box = document.createElement('div');
		box.style.marginTop = '10px';
		box.style.padding = '8px 10px';
		box.style.backgroundColor = '#252525';
		box.style.borderRadius = '4px';
		box.style.border = '1px solid #333';
		box.style.fontSize = '11px';
		box.style.color = '#aaa';
		box.style.lineHeight = '1.4';
		box.textContent = text;
		return box;
	}
}
