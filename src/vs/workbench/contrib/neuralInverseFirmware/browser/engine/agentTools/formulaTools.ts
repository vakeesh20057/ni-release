/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFormulaVerifierService, FormulaType } from '../verification/formulaVerifierService.js';


export function buildFormulaTools(formulaService: IFormulaVerifierService): IVoidInternalTool[] {
	return [
		_fwVerifyFormula(formulaService),
		_fwListFormulas(formulaService),
	];
}


function _fwVerifyFormula(svc: IFormulaVerifierService): IVoidInternalTool {
	return {
		name: 'fw_verify_formula',
		description: 'Verify a firmware configuration formula (baud rate, PLL, timer, SPI clock, etc.) against datasheet specifications. Catches prescaler errors and out-of-spec configurations before flashing.',
		params: {
			type: { description: 'Formula type: "uart-baud", "spi-clock", "i2c-frequency", "timer-period", "timer-frequency", "pll-output", "adc-conversion-time", "pwm-frequency", "pwm-duty", "can-bitrate"' },
			params: { description: 'JSON object of formula parameters (see fw_list_formulas for required params per type)' },
			expected: { description: 'Optional: expected output value to compare against' },
		},
		execute: async (args: Record<string, any>) => {
			const type = args.type as FormulaType;
			if (!type) return 'Error: provide a formula type.';

			let params: Record<string, number>;
			try {
				params = typeof args.params === 'string' ? JSON.parse(args.params) : args.params;
			} catch {
				return 'Error: params must be a valid JSON object with numeric values.';
			}

			const expected = args.expected !== undefined ? Number(args.expected) : undefined;

			const result = svc.verify({ type, params, expected });

			const lines = [
				`Formula: ${type}`,
				`Expression: ${result.formula}`,
				`Computed: ${result.computed} ${result.unit}`,
			];

			if (result.error) {
				lines.push('', `⚠ MISMATCH: ${result.error.message}`);
				lines.push(`  Deviation: ${result.error.deviation > 0 ? '+' : ''}${result.error.deviation.toFixed(4)} ${result.unit} (${result.error.deviationPercent.toFixed(3)}%)`);
			} else if (expected !== undefined) {
				lines.push(`✓ Matches expected value: ${expected} ${result.unit}`);
			}

			if (result.warnings.length > 0) {
				lines.push('', 'Warnings:');
				for (const w of result.warnings) {
					lines.push(`  ⚠ ${w}`);
				}
			}

			return lines.join('\n');
		},
	};
}


function _fwListFormulas(svc: IFormulaVerifierService): IVoidInternalTool {
	return {
		name: 'fw_list_formulas',
		description: 'List all available formula verification types with their required parameters.',
		params: {},
		execute: async () => {
			const templates = svc.listFormulas();
			const lines = ['Available Formula Verifications:', ''];

			for (const t of templates) {
				lines.push(`${t.type} — ${t.description}`);
				lines.push(`  Output: ${t.outputUnit}`);
				lines.push(`  Parameters:`);
				for (const p of t.params) {
					lines.push(`    ${p.name}: ${p.description} (${p.unit})`);
				}
				lines.push('');
			}

			return lines.join('\n');
		},
	};
}
