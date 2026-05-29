/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Peripheral dependency chain agent tools
 *
 * Answers "why doesn't my USART/SPI/I2C work?" with a concrete checklist
 * of prerequisite register writes (RCC clock, GPIO AF, NVIC, DMA).
 * Generates complete ordered initialization sequences including all deps.
 */

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { PeripheralDependencyService } from '../dependencies/peripheralDependencyService.js';

export function buildDependencyTools(session: IFirmwareSessionService): IVoidInternalTool[] {
	const depService = new PeripheralDependencyService(session);

	return [
		_fwCheckPeripheralDeps(session, depService),
		_fwGenerateInitSequence(session, depService),
	];
}


function _fwCheckPeripheralDeps(session: IFirmwareSessionService, depService: PeripheralDependencyService): IVoidInternalTool {
	return {
		name: 'fw_check_peripheral_deps',
		description: 'Check the initialization dependency chain for a peripheral. Returns every prerequisite step needed (RCC clock enable, GPIO AF config, DMA setup, NVIC enable) with their current status: satisfied (found in source), missing, or unknown. The most common reason peripherals do not work is a missing dependency — this tool identifies exactly which one.',
		params: {
			peripheral: { description: 'Peripheral name, e.g. "USART1", "SPI2", "I2C1", "TIM3", "ADC1".' },
			sourceCode: { description: 'Optional: paste the initialization code to check which dependencies are already satisfied. If omitted, returns the full dependency chain without status checking.' },
			useDMA: { description: 'Optional: set to true if using DMA with this peripheral. Default: false.' },
			useInterrupt: { description: 'Optional: set to true if using interrupts. Default: true.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const peripheral = args.peripheral as string | undefined;
			if (!peripheral) { return 'Provide peripheral name, e.g. "USART1", "SPI2".'; }

			const options = {
				useDMA: args.useDMA === true,
				useInterrupt: args.useInterrupt !== false,
				useHAL: false,
			};

			const sourceCode = args.sourceCode as string | undefined;

			if (sourceCode) {
				const report = depService.checkDependencies(peripheral, sourceCode, options);

				const lines = [
					`Dependency check for ${report.peripheral}:`,
					`Status: ${report.allSatisfied ? 'ALL SATISFIED' : `${report.missingCount} MISSING, ${report.unknownCount} unknown`}`,
					'',
				];

				for (const result of report.results) {
					const icon = result.status === 'satisfied' ? '[OK]' : result.status === 'missing' ? '[MISSING]' : '[?]';
					const suffix = result.node.optional ? ' (optional)' : '';
					lines.push(`  ${icon} ${result.node.description}${suffix}`);
					if (result.evidence) {
						lines.push(`       Found: ${result.evidence}`);
					}
					if (result.status === 'missing' && !result.node.optional) {
						lines.push(`       Fix: ${result.node.codeSnippet.split('\n')[0]}`);
					}
				}

				if (report.chain.notes.length > 0) {
					lines.push('');
					lines.push('Notes:');
					for (const note of report.chain.notes) {
						lines.push(`  - ${note}`);
					}
				}

				return lines.join('\n');
			}

			// No source code — just show the full chain
			const chain = depService.getDependencyChain(peripheral, options);

			const lines = [
				`Initialization dependencies for ${chain.peripheral}:`,
				`(${chain.nodes.filter(n => !n.optional).length} required, ${chain.nodes.filter(n => n.optional).length} optional)`,
				'',
			];

			let order = 0;
			for (const node of chain.nodes) {
				order++;
				const marker = node.optional ? `${order}. [optional${node.condition ? `: ${node.condition}` : ''}]` : `${order}.`;
				lines.push(`${marker} ${node.description}`);
				lines.push(`   Register: ${node.register}${node.bitField ? `.${node.bitField}` : ''}`);
				lines.push(`   Code: ${node.codeSnippet.split('\n')[0]}`);
				lines.push('');
			}

			if (chain.notes.length > 0) {
				lines.push('Platform notes:');
				for (const note of chain.notes) {
					lines.push(`  - ${note}`);
				}
			}

			return lines.join('\n');
		},
	};
}


function _fwGenerateInitSequence(session: IFirmwareSessionService, depService: PeripheralDependencyService): IVoidInternalTool {
	return {
		name: 'fw_generate_init_sequence',
		description: 'Generate a COMPLETE initialization sequence for a peripheral including ALL dependencies in the correct order. Unlike fw_generate_peripheral_init (which assumes clock/GPIO are done), this generates everything from scratch: RCC clock enable, GPIO AF configuration, optional DMA setup, NVIC, peripheral registers, and the final enable bit. Ready to paste into main.c.',
		params: {
			peripheral: { description: 'Peripheral name, e.g. "USART1", "SPI2", "I2C1", "TIM3".' },
			useDMA: { description: 'Include DMA stream configuration. Default: false.' },
			useInterrupt: { description: 'Include NVIC setup. Default: true.' },
			rtos: { description: 'Optional: "freertos" or "zephyr" — adjusts NVIC priority guidance.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const peripheral = args.peripheral as string | undefined;
			if (!peripheral) { return 'Provide peripheral name.'; }

			const options = {
				useDMA: args.useDMA === true,
				useInterrupt: args.useInterrupt !== false,
				useHAL: false,
				rtos: (args.rtos as 'freertos' | 'zephyr' | undefined) ?? (s.rtos as any) ?? 'none',
			};

			return depService.generateInitSequence(peripheral, options);
		},
	};
}
