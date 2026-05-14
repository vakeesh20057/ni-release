/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * PowerModePart — dedicated auxiliary window for Power Mode.
 *
 * Hosts the PowerModeTerminalHost in its own window so Power Mode is
 * independent of the Agent Manager. Designed to be extended in future
 * with a top toolbar, session tabs, and tool-approval controls.
 */

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { Part } from '../../../browser/part.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IPowerModeService } from './powerModeService.js';
import { PowerModeTerminalHost } from './powerModeTerminalHost.js';

export class PowerModePart extends Part {

	static readonly ID = 'workbench.parts.powerMode';

	minimumWidth: number = 400;
	maximumWidth: number = Infinity;
	minimumHeight: number = 300;
	maximumHeight: number = Infinity;

	private _terminalHost: PowerModeTerminalHost | undefined;
	private readonly _disposables = new DisposableStore();

	constructor(
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IPowerModeService private readonly powerModeService: IPowerModeService,
	) {
		super(PowerModePart.ID, { hasTitle: false }, themeService, storageService, layoutService);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		const container = document.createElement('div');
		container.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:#1a2332;';
		parent.appendChild(container);

		// ── Top bar ───────────────────────────────────────────────────────────
		const topbar = document.createElement('div');
		topbar.style.cssText = [
			'display:flex', 'align-items:center', 'justify-content:space-between',
			'height:32px', 'min-height:32px', 'padding:0 12px',
			'background:#151d2b', 'border-bottom:1px solid #2a3545',
			'font-family:var(--vscode-font-family,monospace)', 'font-size:12px',
		].join(';');

		const brand = document.createElement('span');
		brand.textContent = 'Neural Inverse · Power Mode';
		brand.style.cssText = 'color:#5eaed6;font-weight:bold;letter-spacing:0.03em;';
		topbar.appendChild(brand);

		const hint = document.createElement('span');
		hint.textContent = 'Ctrl+Alt+P to open/focus';
		hint.style.cssText = 'color:#3a4a5e;font-size:11px;';
		topbar.appendChild(hint);

		container.appendChild(topbar);

		// ── Terminal body ─────────────────────────────────────────────────────
		const terminalContainer = document.createElement('div');
		terminalContainer.style.cssText = 'flex:1;position:relative;overflow:hidden;';
		container.appendChild(terminalContainer);

		this._terminalHost = new PowerModeTerminalHost(this.terminalService, this.powerModeService);
		this._disposables.add(this._terminalHost);
		this._terminalHost.createTerminal(terminalContainer);

		return parent;
	}

	override layout(width: number, height: number, top: number, left: number): void {
		super.layout(width, height, top, left);
		// Re-fit the xterm terminal on resize
		setTimeout(() => this._terminalHost?.layout(), 20);
	}

	override toJSON(): object {
		return { id: PowerModePart.ID };
	}

	override dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}
}
