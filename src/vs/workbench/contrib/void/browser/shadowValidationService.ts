/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { URI } from '../../../../base/common/uri.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

export interface IShadowValidationResult {
	hasErrors: boolean;
	hasWarnings: boolean;
	errorText: string;
	diagnostics: IShadowDiagnostic[];
}

export interface IShadowDiagnostic {
	file: string;
	line: number;
	col: number;
	endLine: number;
	endCol: number;
	severity: 'error' | 'warning';
	message: string;
	code: string;
	source: string;
}

export interface IShadowValidationService {
	readonly _serviceBrand: undefined;
	validateAfterEdit(uri: URI, opts?: IShadowValidationOptions): Promise<IShadowValidationResult>;
	formatForLLM(result: IShadowValidationResult): string;
}

export interface IShadowValidationOptions {
	timeoutMs?: number;
	stabilizationMs?: number;
	severity?: 'error' | 'all';
	token?: CancellationToken;
}

export const IShadowValidationService = createDecorator<IShadowValidationService>('shadowValidationService');

const EMPTY_RESULT: IShadowValidationResult = { hasErrors: false, hasWarnings: false, errorText: '', diagnostics: [] };

class ShadowValidationService extends Disposable implements IShadowValidationService {
	_serviceBrand: undefined;

	constructor(
		@IMarkerService private readonly _markerService: IMarkerService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super();
	}

	async validateAfterEdit(uri: URI, opts?: IShadowValidationOptions): Promise<IShadowValidationResult> {
		if (!this._settingsService.state.globalSettings.includeToolLintErrors) {
			return EMPTY_RESULT;
		}

		const timeoutMs = opts?.timeoutMs ?? 2000;
		const stabilizationMs = opts?.stabilizationMs ?? 300;
		const severityFilter = opts?.severity ?? 'all';
		const token = opts?.token ?? CancellationToken.None;

		if (token.isCancellationRequested) {
			return EMPTY_RESULT;
		}

		const baseline = new Set(
			this._markerService.read({ resource: uri })
				.map(m => `${m.startLineNumber}:${m.startColumn}:${m.message}`)
		);

		const result = await this._waitForMarkerChange(uri, timeoutMs, stabilizationMs, token);
		if (!result) {
			return EMPTY_RESULT;
		}

		const severities = severityFilter === 'error'
			? MarkerSeverity.Error
			: MarkerSeverity.Error | MarkerSeverity.Warning;

		const markers = this._markerService.read({ resource: uri })
			.filter(m => (m.severity & severities) !== 0)
			.filter(m => !baseline.has(`${m.startLineNumber}:${m.startColumn}:${m.message}`));

		if (markers.length === 0) {
			return EMPTY_RESULT;
		}

		const diagnostics: IShadowDiagnostic[] = markers.slice(0, 50).map(m => ({
			file: uri.fsPath,
			line: m.startLineNumber,
			col: m.startColumn,
			endLine: m.endLineNumber,
			endCol: m.endColumn,
			severity: m.severity === MarkerSeverity.Error ? 'error' as const : 'warning' as const,
			message: m.message,
			code: typeof m.code === 'string' ? m.code : m.code?.value ?? '',
			source: m.source ?? '',
		}));

		const hasErrors = diagnostics.some(d => d.severity === 'error');
		const hasWarnings = diagnostics.some(d => d.severity === 'warning');
		const errorText = this._formatDiagnostics(diagnostics);

		return { hasErrors, hasWarnings, errorText, diagnostics };
	}

	formatForLLM(result: IShadowValidationResult): string {
		if (!result.hasErrors && !result.hasWarnings) {
			return '';
		}
		return result.errorText;
	}

	private _waitForMarkerChange(uri: URI, timeoutMs: number, stabilizationMs: number, token: CancellationToken): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let stabTimer: ReturnType<typeof setTimeout> | undefined;
			let resolved = false;

			const finish = (value: boolean) => {
				if (resolved) return;
				resolved = true;
				if (timer) clearTimeout(timer);
				if (stabTimer) clearTimeout(stabTimer);
				disposable.dispose();
				tokenDisposable.dispose();
				resolve(value);
			};

			const disposable = this._markerService.onMarkerChanged(changedUris => {
				const relevant = changedUris.some(u => u.toString() === uri.toString());
				if (!relevant) return;

				if (stabTimer) clearTimeout(stabTimer);
				stabTimer = setTimeout(() => finish(true), stabilizationMs);
			});

			const tokenDisposable = token.onCancellationRequested(() => finish(false));

			timer = setTimeout(() => {
				// Timeout — check if there are any markers already (language server may have already responded)
				const existing = this._markerService.read({ resource: uri })
					.filter(m => m.severity === MarkerSeverity.Error || m.severity === MarkerSeverity.Warning);
				finish(existing.length > 0);
			}, timeoutMs);
		});
	}

	private _formatDiagnostics(diagnostics: IShadowDiagnostic[]): string {
		const lines = diagnostics.map(d => {
			const sev = d.severity === 'error' ? 'ERROR' : 'WARN';
			const codeStr = d.code ? ` (${d.code})` : '';
			const srcStr = d.source ? `[${d.source}] ` : '';
			return `[${sev}] ${d.file}:${d.line}:${d.col} — ${srcStr}${d.message}${codeStr}`;
		});

		const header = '\n⚠ Diagnostics after edit:';
		const footer = '\nFix these errors before proceeding.';
		return header + '\n' + lines.join('\n') + footer;
	}
}

registerSingleton(IShadowValidationService, ShadowValidationService, InstantiationType.Delayed);
