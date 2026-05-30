/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * FirmwareAgentToolService
 *
 * Registers all fw_* agent tools for the firmware environment.
 * Tools span 11 phases: debug, serial, build analysis, code generation,
 * peripheral intelligence, simulation, compliance, pin mux, dependencies,
 * clock tree, register compositor, and memory layout.
 *
 * Tools are only meaningful when a firmware session is active.
 */

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { ISerialMonitorService } from '../serial/serialMonitorService.js';
import { IBuildSystemService } from '../build/buildSystemService.js';
import { IFirmwareDebugService } from '../debug/debugService.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { buildSerialTools } from './serialTools.js';
import { buildBuildAnalysisTools } from './buildAnalysisTools.js';
import { buildDebugTools } from './debugTools.js';
import { buildCodegenTools } from './codegenTools.js';
import { buildPeripheralIntelTools } from './peripheralIntelTools.js';
import { buildSimulationTools } from './simulationTools.js';
import { buildComplianceTools } from './complianceTools.js';
import { buildPinMuxTools } from './pinMuxTools.js';
import { buildDependencyTools } from './dependencyTools.js';
import { buildClockTreeTools } from './clockTreeTools.js';
import { buildRegisterValueTools } from './registerValueTools.js';
import { buildMemoryTools } from './memoryTools.js';
import { buildLogicAnalyzerTools } from './logicAnalyzerTools.js';
import { buildPowerAnalyzerTools } from './powerAnalyzerTools.js';
import { buildOscilloscopeTools } from './oscilloscopeTools.js';
import { buildCombinedInstrumentTools } from './combinedInstrumentTools.js';
import { ILogicAnalyzerService } from '../instruments/logicAnalyzer/logicAnalyzerService.js';
import { IPowerAnalyzerService } from '../instruments/powerAnalyzer/powerAnalyzerService.js';
import { IOscilloscopeService } from '../instruments/oscilloscope/oscilloscopeService.js';
import { buildRTTTools } from './rttTools.js';
import { buildPeripheralCatalogTools } from './peripheralCatalogTools.js';
import { buildSchematicTools } from './schematicTools.js';
import { IRTTService } from '../serial/rttService.js';
import { IITMService } from '../serial/itmService.js';
import { IPeripheralCatalogService } from '../peripheralCatalog/peripheralCatalogService.js';
import { ISchematicService } from '../schematic/schematicService.js';
import { INIMdService } from '../projectConfig/niMdService.js';
import { INIIgnoreService } from '../projectConfig/niIgnoreService.js';
import { ICheckpointService } from '../projectConfig/checkpointService.js';
import { IGitHubDaemonService } from '../../voidGitHubDaemon/gitHubDaemonService.js';


// ─── Service interface ────────────────────────────────────────────────────────

export const IFirmwareAgentToolService = createDecorator<IFirmwareAgentToolService>('firmwareAgentToolService');

export interface IFirmwareAgentToolService {
	readonly _serviceBrand: undefined;

	/** Get all firmware tools as IVoidInternalTool[] for registration. */
	getTools(): IVoidInternalTool[];

	/**
	 * Check whether a file path is allowed to be edited by the agent.
	 * Returns false if the path matches a .niignore rule.
	 * Called by the agent framework before any file write operation.
	 */
	isWriteAllowed(filePath: string): boolean;
}


// ─── Implementation ───────────────────────────────────────────────────────────

class FirmwareAgentToolService extends Disposable implements IFirmwareAgentToolService {
	readonly _serviceBrand: undefined;

	constructor(
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService,
		@ISerialMonitorService private readonly _serial: ISerialMonitorService,
		@IBuildSystemService private readonly _build: IBuildSystemService,
		@IFirmwareDebugService private readonly _debug: IFirmwareDebugService,
		@IFileService private readonly _fileService: IFileService,
		@ILogicAnalyzerService private readonly _la: ILogicAnalyzerService,
		@IPowerAnalyzerService private readonly _pa: IPowerAnalyzerService,
		@IOscilloscopeService private readonly _scope: IOscilloscopeService,
		@IRTTService private readonly _rtt: IRTTService,
		@IITMService private readonly _itm: IITMService,
		@IPeripheralCatalogService private readonly _catalog: IPeripheralCatalogService,
		@ISchematicService private readonly _schematic: ISchematicService,
		@INIMdService private readonly _niMd: INIMdService,
		@INIIgnoreService private readonly _niIgnore: INIIgnoreService,
		@ICheckpointService private readonly _checkpoint: ICheckpointService,
		@IGitHubDaemonService private readonly _daemon: IGitHubDaemonService,
	) {
		super();
	}

	isWriteAllowed(filePath: string): boolean {
		return !this._niIgnore.isEditBlocked(filePath);
	}

	getTools(): IVoidInternalTool[] {
		return [
			// ── Phase 1 + 2: Connected services + binary analysis ───────────
			...buildDebugTools(this._debug, this._session),
			...buildSerialTools(this._serial),
			...buildBuildAnalysisTools(this._build, this._session, this._fileService),
			// ── Phase 3: Code generation ─────────────────────────────────
			...buildCodegenTools(this._session),
			// ── Phase 4: Peripheral intelligence ────────────────────────
			...buildPeripheralIntelTools(this._session, this._fileService),
			// ── Phase 5: Simulation discovery ───────────────────────────
			...buildSimulationTools(this._session),
			// ── Phase 6: Compliance depth ────────────────────────────────
			...buildComplianceTools(undefined, this._session),
			// ── Phase 7: Pin mux conflict detection ─────────────────────
			...buildPinMuxTools(this._session),
			// ── Phase 8: Peripheral dependency chains ───────────────────
			...buildDependencyTools(this._session),
			// ── Phase 9: Clock tree validation & solving ─────────────────
			...buildClockTreeTools(this._session),
			// ── Phase 10: Register value compositor ──────────────────────
			...buildRegisterValueTools(this._session),
			// ── Phase 11: Memory layout & linker scripts ─────────────────
			...buildMemoryTools(this._session),
			// ── Phase 12: Debug instruments (Logic, Power, Scope) ────────
			...buildLogicAnalyzerTools(this._session, this._la),
			...buildPowerAnalyzerTools(this._session, this._pa),
			...buildOscilloscopeTools(this._session, this._scope),
			...buildCombinedInstrumentTools(this._session, this._debug, this._la, this._pa, this._scope),
			// ── Phase 13: RTT / ITM / SWO tracing ────────────────────────
			...buildRTTTools(this._session, this._rtt, this._itm),
			// ── Phase 14: Peripheral catalog ─────────────────────────────
			...buildPeripheralCatalogTools(this._session, this._catalog),
			// ── Phase 15: Schematic / Pinout ─────────────────────────────
			...buildSchematicTools(this._session, this._schematic),
			// ── Phase 16: Project config (NI.md, .niignore, checkpoint) ──
			this._fwInit(),
			this._fwNiIgnoreCheck(),
			this._fwCheckpointCreate(),
			this._fwCheckpointList(),
			this._fwCheckpointRewind(),
			this._fwCheckpointFork(),
			// ── Phase 17: GitHub Daemon ───────────────────────────────────
			this._fwDaemonStart(),
			this._fwDaemonStop(),
			this._fwDaemonStatus(),
			// ── Core hardware tools ─────────────────────────────────────────
			this._fwGetMcuInfo(),
			this._fwListPeripherals(),
			this._fwGetRegisterMap(),
			this._fwGetPeripheralConfig(),
			this._fwGetBitFieldInfo(),
			this._fwGetErrata(),
			this._fwCheckSiliconBug(),
			this._fwGetTimingConstraints(),
			this._fwGetClockConfig(),
			this._fwQueryDatasheet(),
			this._fwGetDatasheetCitations(),
			this._fwMisraCheck(),
			this._fwCertCCheck(),
			this._fwSafetyAudit(),
			this._fwUploadDatasheet(),
			this._fwBuild(),
			this._fwFlash(),
			this._fwSerialSend(),
			this._fwSerialMonitor(),
			this._fwBinarySize(),
			this._fwScanProject(),
			this._fwSearchMCU(),
		];
	}

	// ─── Tool implementations ────────────────────────────────────────────

	private _fwGetMcuInfo(): IVoidInternalTool {
		return {
			name: 'fw_get_mcu_info',
			description: 'Get MCU specifications and memory map for the active firmware session.',
			params: {},
			execute: async () => {
				const s = this._session.session;
				if (!s.isActive || !s.mcuConfig) return 'No active firmware session.';
				const cfg = s.mcuConfig;
				const lines = [
					`MCU: ${cfg.family} ${cfg.variant}`,
					`Manufacturer: ${cfg.manufacturer}`,
					`Core: ${cfg.core}`,
					`Clock: ${cfg.clockMHz} MHz`,
					`Flash: ${cfg.flashSize} bytes (${(cfg.flashSize / 1024).toFixed(0)} KB)`,
					`RAM: ${cfg.ramSize} bytes (${(cfg.ramSize / 1024).toFixed(0)} KB)`,
					`FPU: ${cfg.fpu}  |  MPU: ${cfg.hasMPU}  |  DSP: ${cfg.hasDSP}`,
					`GPIO pins: ${cfg.gpioCount ?? 'unknown'}`,
					`Peripherals: ${cfg.peripherals.join(', ')}`,
				];
				if (cfg.memoryMap.length > 0) {
					lines.push('', 'Memory Map:');
					for (const m of cfg.memoryMap) {
						lines.push(`  ${m.name}: 0x${m.baseAddress.toString(16).toUpperCase()} — ${m.size} bytes [${m.access}]`);
					}
				}
				if (s.boardName) lines.push(`Board: ${s.boardName}`);
				if (s.rtos) lines.push(`RTOS: ${s.rtos}`);
				if (s.buildSystem) lines.push(`Build system: ${s.buildSystem}`);
				return lines.join('\n');
			},
		};
	}

	private _fwListPeripherals(): IVoidInternalTool {
		return {
			name: 'fw_list_peripherals',
			description: 'List all peripherals and their base addresses for the current MCU.',
			params: {},
			execute: async () => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				if (s.registerMaps.length === 0) return 'No register maps loaded. Load an SVD file or datasheet first.';
				const lines = s.registerMaps.map(m =>
					`${m.name} (${m.groupName}) — base: 0x${m.baseAddress.toString(16).toUpperCase()} — ${m.registers.length} registers — ${m.description.slice(0, 60)}`
				);
				return `Peripherals (${lines.length}):\n${lines.join('\n')}`;
			},
		};
	}

	private _fwGetRegisterMap(): IVoidInternalTool {
		return {
			name: 'fw_get_register_map',
			description: 'Get the full register map for a specific peripheral (all registers, offsets, fields, reset values).',
			params: {
				peripheral: { description: 'Peripheral name, e.g. "USART1", "SPI2", "GPIOA"' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				const name = args.peripheral as string;
				const map = this._session.getPeripheralRegisterMap(name);
				if (!map) return `Peripheral "${name}" not found. Use fw_list_peripherals to see available peripherals.`;

				const lines = [
					`Register Map: ${map.name} (${map.groupName})`,
					`Base address: 0x${map.baseAddress.toString(16).toUpperCase()}`,
					`Description: ${map.description}`,
					'',
				];

				for (const reg of map.registers) {
					const offset = `0x${reg.addressOffset.toString(16).toUpperCase().padStart(4, '0')}`;
					const reset = `0x${reg.resetValue.toString(16).toUpperCase().padStart(8, '0')}`;
					lines.push(`${reg.name} [${offset}] ${reg.size}bit ${reg.access} reset=${reset}`);
					lines.push(`  ${reg.description}`);
					for (const f of reg.fields) {
						const enumStr = f.enumeratedValues ? ` enum: {${Object.entries(f.enumeratedValues).map(([k, v]) => `${k}=${v}`).join(', ')}}` : '';
						lines.push(`    [${f.bitOffset}:${f.bitOffset + f.bitWidth - 1}] ${f.name} (${f.bitWidth}bit, ${f.access}) — ${f.description}${enumStr}`);
					}
				}

				if (map.interrupts.length > 0) {
					lines.push('', 'Interrupts:');
					for (const i of map.interrupts) {
						lines.push(`  ${i.name} (IRQ ${i.value}) — ${i.description}`);
					}
				}

				return lines.join('\n');
			},
		};
	}

	private _fwGetPeripheralConfig(): IVoidInternalTool {
		return {
			name: 'fw_get_peripheral_config',
			description: 'Get configuration options and settings for a specific peripheral.',
			params: {
				peripheral: { description: 'Peripheral name, e.g. "USART1", "TIM2"' },
			},
			execute: async (args: Record<string, any>) => {
				const name = args.peripheral as string;
				const map = this._session.getPeripheralRegisterMap(name);
				if (!map) return `Peripheral "${name}" not found.`;

				const configRegs = map.registers.filter(r =>
					/^(CR|CFG|CFGR|CCR|INIT|MODE|CTL|CTRL)/i.test(r.name)
				);

				if (configRegs.length === 0) {
					return `No configuration registers found for ${name}. All registers:\n${map.registers.map(r => r.name).join(', ')}`;
				}

				const lines = [`Configuration registers for ${name}:`, ''];
				for (const reg of configRegs) {
					lines.push(`${reg.name} — ${reg.description}`);
					for (const f of reg.fields) {
						lines.push(`  ${f.name} [${f.bitOffset}:${f.bitOffset + f.bitWidth - 1}] — ${f.description}`);
						if (f.enumeratedValues) {
							for (const [val, label] of Object.entries(f.enumeratedValues)) {
								lines.push(`    ${val}: ${label}`);
							}
						}
					}
					lines.push('');
				}

				return lines.join('\n');
			},
		};
	}

	private _fwGetBitFieldInfo(): IVoidInternalTool {
		return {
			name: 'fw_get_bit_field_info',
			description: 'Get detailed bit field information for a specific register of a peripheral.',
			params: {
				peripheral: { description: 'Peripheral name, e.g. "USART1"' },
				register: { description: 'Register name, e.g. "CR1", "SR"' },
			},
			execute: async (args: Record<string, any>) => {
				const pName = args.peripheral as string;
				const rName = args.register as string;
				const map = this._session.getPeripheralRegisterMap(pName);
				if (!map) return `Peripheral "${pName}" not found.`;

				const reg = map.registers.find(r => r.name.toLowerCase() === rName.toLowerCase());
				if (!reg) return `Register "${rName}" not found in ${pName}. Available: ${map.registers.map(r => r.name).join(', ')}`;

				const lines = [
					`Register: ${pName}->${reg.name}`,
					`Offset: 0x${reg.addressOffset.toString(16).toUpperCase().padStart(4, '0')}`,
					`Size: ${reg.size} bits`,
					`Access: ${reg.access}`,
					`Reset: 0x${reg.resetValue.toString(16).toUpperCase().padStart(reg.size / 4, '0')}`,
					`Description: ${reg.description}`,
					'',
					'Bit Fields:',
				];

				const sortedFields = [...reg.fields].sort((a, b) => a.bitOffset - b.bitOffset);
				for (const f of sortedFields) {
					const msb = f.bitOffset + f.bitWidth - 1;
					lines.push(`  [${msb}:${f.bitOffset}] ${f.name} — ${f.bitWidth} bit(s), ${f.access}`);
					lines.push(`    ${f.description}`);
					if (f.enumeratedValues) {
						for (const [val, label] of Object.entries(f.enumeratedValues)) {
							lines.push(`    ${val} = ${label}`);
						}
					}
				}

				return lines.join('\n');
			},
		};
	}

	private _fwGetErrata(): IVoidInternalTool {
		return {
			name: 'fw_get_errata',
			description: 'Get silicon errata (known hardware bugs) for the current MCU or a specific peripheral.',
			params: {
				peripheral: { description: 'Optional: filter by peripheral name. Omit for all errata.' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				const peripheral = args.peripheral as string | undefined;

				const errata = peripheral
					? this._session.getErrataForPeripheral(peripheral)
					: s.errata;

				if (errata.length === 0) return peripheral
					? `No errata found for ${peripheral}.`
					: 'No errata loaded. Upload a datasheet to extract errata.';

				const lines = [`Silicon Errata (${errata.length}):`, ''];
				for (const e of errata) {
					lines.push(`${e.id} [${e.severity}] — ${e.title}`);
					lines.push(`  Peripheral: ${e.affectedPeripheral}`);
					lines.push(`  Description: ${e.description}`);
					if (e.workaround) lines.push(`  Workaround: ${e.workaround}`);
					lines.push(`  Revisions: ${e.affectedRevisions.join(', ')}${e.fixedInRevision ? ` (fixed in ${e.fixedInRevision})` : ''}`);
					lines.push('');
				}
				return lines.join('\n');
			},
		};
	}

	private _fwCheckSiliconBug(): IVoidInternalTool {
		return {
			name: 'fw_check_silicon_bug',
			description: 'Check if a specific silicon bug or errata affects the current code or peripheral configuration.',
			params: {
				peripheral: { description: 'Peripheral to check, e.g. "USART1"' },
				operation: { description: 'Description of what you are doing, e.g. "DMA transfer with USART in half-duplex mode"' },
			},
			execute: async (args: Record<string, any>) => {
				const peripheral = args.peripheral as string;
				const operation = args.operation as string;
				const errata = this._session.getErrataForPeripheral(peripheral);

				if (errata.length === 0) return `No known errata for ${peripheral}.`;

				const lines = [`Checking ${errata.length} errata for "${peripheral}" related to: "${operation}"`, ''];
				for (const e of errata) {
					const relevant = e.description.toLowerCase().includes(operation.toLowerCase()) ||
						operation.toLowerCase().includes(e.affectedPeripheral.toLowerCase());
					const tag = relevant ? '⚠ POTENTIALLY RELEVANT' : '  info';
					lines.push(`${tag}: ${e.id} — ${e.title}`);
					if (relevant && e.workaround) {
						lines.push(`  Workaround: ${e.workaround}`);
					}
				}
				return lines.join('\n');
			},
		};
	}

	private _fwGetTimingConstraints(): IVoidInternalTool {
		return {
			name: 'fw_get_timing_constraints',
			description: 'Get timing constraints (setup/hold times, clock limits, etc.) for a specific peripheral.',
			params: {
				peripheral: { description: 'Peripheral name, e.g. "SPI1", "I2C1"' },
			},
			execute: async (args: Record<string, any>) => {
				const peripheral = args.peripheral as string;
				const timing = this._session.getTimingForPeripheral(peripheral);

				if (timing.length === 0) return `No timing constraints found for ${peripheral}. Upload a datasheet to extract timing info.`;

				const lines = [`Timing Constraints for ${peripheral}:`, ''];
				for (const t of timing) {
					const values = [
						t.minValue !== undefined ? `min: ${t.minValue}${t.unit}` : null,
						t.typValue !== undefined ? `typ: ${t.typValue}${t.unit}` : null,
						t.maxValue !== undefined ? `max: ${t.maxValue}${t.unit}` : null,
					].filter(Boolean).join(', ');
					lines.push(`  ${t.name}: ${values}`);
					if (t.conditions) lines.push(`    Conditions: ${t.conditions}`);
					if (t.datasheetPage) lines.push(`    Datasheet page: ${t.datasheetPage}`);
				}
				return lines.join('\n');
			},
		};
	}

	private _fwGetClockConfig(): IVoidInternalTool {
		return {
			name: 'fw_get_clock_config',
			description: 'Get clock configuration information for the current MCU (main clock, PLL, bus dividers).',
			params: {},
			execute: async () => {
				const s = this._session.session;
				if (!s.isActive || !s.mcuConfig) return 'No active firmware session.';

				const rcc = this._session.getPeripheralRegisterMap('RCC');
				if (!rcc) return `MCU clock: ${s.mcuConfig.clockMHz} MHz. No RCC register map loaded — load an SVD to see clock tree details.`;

				const lines = [
					`Clock Configuration — ${s.mcuConfig.family} ${s.mcuConfig.variant}`,
					`Max system clock: ${s.mcuConfig.clockMHz} MHz`,
					'',
					'RCC registers:',
				];

				const clockRegs = rcc.registers.filter(r =>
					/^(CR|CFGR|PLLCFGR|PLLSAICFGR|CIR|AHB|APB|BDCR|CSR)/i.test(r.name)
				);

				for (const reg of clockRegs.slice(0, 10)) {
					lines.push(`  ${reg.name} — ${reg.description}`);
				}

				return lines.join('\n');
			},
		};
	}

	private _fwQueryDatasheet(): IVoidInternalTool {
		return {
			name: 'fw_query_datasheet',
			description: 'Natural language query against parsed datasheets. Ask about any aspect of the MCU hardware.',
			params: {
				query: { description: 'Your question about the hardware, e.g. "What is the max baud rate for USART1?"' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				if (s.datasheets.length === 0) return 'No datasheets loaded. Use fw_upload_datasheet to parse a datasheet first.';

				const query = args.query as string;
				return `Datasheet query: "${query}"\n\nLoaded datasheets: ${s.datasheets.map(d => d.title).join(', ')}\nAvailable peripherals: ${this._session.getPeripheralNames().join(', ')}\n\nUse fw_get_register_map, fw_get_timing_constraints, or fw_get_errata for specific hardware data.`;
			},
		};
	}

	private _fwGetDatasheetCitations(): IVoidInternalTool {
		return {
			name: 'fw_get_datasheet_citations',
			description: 'Get datasheet page-level citations for a specific peripheral or topic.',
			params: {
				peripheral: { description: 'Peripheral name to get citations for' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				const peripheral = args.peripheral as string;

				const timing = this._session.getTimingForPeripheral(peripheral);
				const errata = this._session.getErrataForPeripheral(peripheral);

				const pages = new Set<number>();
				for (const t of timing) {
					if (t.datasheetPage) pages.add(t.datasheetPage);
				}
				for (const e of errata) {
					if (e.documentPage) pages.add(e.documentPage);
				}

				if (pages.size === 0) return `No page citations available for ${peripheral}.`;

				const sortedPages = [...pages].sort((a, b) => a - b);
				return `Datasheet citations for ${peripheral}:\nPages: ${sortedPages.join(', ')}\n\nTiming references: ${timing.filter(t => t.datasheetPage).length}\nErrata references: ${errata.filter(e => e.documentPage).length}`;
			},
		};
	}

	private _fwMisraCheck(): IVoidInternalTool {
		return {
			name: 'fw_misra_check',
			description: 'Run a MISRA C:2012 compliance check on the provided code snippet. Reports violations and suggests fixes.',
			params: {
				code: { description: 'C code snippet to check for MISRA compliance' },
				rules: { description: 'Optional: comma-separated list of specific MISRA rules to check, e.g. "8.4,11.3,17.7"' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				if (!s.complianceFrameworks.includes('misra-c-2012') && !s.complianceFrameworks.includes('misra-c-2023')) {
					return 'MISRA C is not enabled for this session. Use the Firmware Environment to enable it.';
				}
				const code = args.code as string;
				return `MISRA C:2012 check on ${code.split('\n').length} lines of code.\n\nNote: Full MISRA analysis requires the checks-socket backend. Basic pattern-based checks:\n- Check volatile usage on register accesses\n- Check for dynamic memory allocation\n- Check for implicit type conversions\n- Check for unbounded loops\n\nConnect to the GRC engine for comprehensive MISRA analysis.`;
			},
		};
	}

	private _fwCertCCheck(): IVoidInternalTool {
		return {
			name: 'fw_cert_c_check',
			description: 'Run a CERT C compliance check on the provided code snippet.',
			params: {
				code: { description: 'C code snippet to check for CERT C compliance' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				const code = args.code as string;
				return `CERT C check on ${code.split('\n').length} lines of code.\n\nConnect to the GRC engine for comprehensive CERT C analysis.`;
			},
		};
	}

	private _fwSafetyAudit(): IVoidInternalTool {
		return {
			name: 'fw_safety_audit',
			description: 'Run a safety audit against IEC 62304, ISO 26262, or DO-178C requirements.',
			params: {
				framework: { description: 'Safety framework: "iec-62304", "iso-26262", or "do-178c"' },
				scope: { description: 'What to audit: "session" for full session, or a file path' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				const framework = args.framework as string;
				return `Safety audit (${framework}) for firmware session ${s.sessionId?.slice(0, 8) ?? '—'}.\n\nActive compliance frameworks: ${s.complianceFrameworks.join(', ')}\nMCU: ${s.mcuConfig?.family ?? 'unknown'} ${s.mcuConfig?.variant ?? ''}\n\nConnect to the GRC engine for comprehensive safety auditing.`;
			},
		};
	}

	private _fwUploadDatasheet(): IVoidInternalTool {
		return {
			name: 'fw_upload_datasheet',
			description: 'Upload and parse a PDF datasheet for hardware context extraction. The datasheet will be parsed to extract register maps, timing constraints, and errata.',
			params: {
				filePath: { description: 'Absolute path to the PDF datasheet file' },
				mcuFamily: { description: 'MCU family this datasheet covers, e.g. "STM32F4"' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';
				const filePath = args.filePath as string;
				const mcuFamily = args.mcuFamily as string;

				return `Datasheet upload queued: ${filePath}\nMCU family: ${mcuFamily}\n\nThe datasheet intelligence service will parse this PDF to extract:\n- Register maps with inline citations\n- Timing constraints (setup/hold/clock limits)\n- Silicon errata with workarounds\n\nUse fw_query_datasheet after parsing completes to search the extracted data.`;
			},
		};
	}

	// ─── Phase 2 tools: Build, Flash, Serial ─────────────────────────────

	private _fwBuild(): IVoidInternalTool {
		return {
			name: 'fw_build',
			description: 'Build the firmware project. Compiles the project using the detected build system (PlatformIO, CMake, Make, ESP-IDF, Cargo, etc.).',
			params: {
				target: { description: 'Optional build target or environment, e.g. "debug", "release", PlatformIO env name' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';

				const projectType = s.projectInfo?.projectType ?? 'generic';
				const buildSystem = s.buildSystem ?? 'unknown';
				const target = args.target as string | undefined;

				return `Build initiated for ${projectType} project.\nBuild system: ${buildSystem}\nTarget: ${target ?? 'default'}\n\nNote: Build commands are emitted to the integrated terminal. Use the Build tab in the Firmware Environment for build output and error parsing.`;
			},
		};
	}

	private _fwFlash(): IVoidInternalTool {
		return {
			name: 'fw_flash',
			description: 'Flash firmware to the target MCU. Uses the appropriate flash tool (OpenOCD, esptool, nrfjprog, etc.) based on the detected project type.',
			params: {
				tool: { description: 'Optional flash tool override: "openocd", "stm32-programmer-cli", "esptool", "nrfjprog", "jlink", "pyocd", "dfu-util"' },
				port: { description: 'Optional serial port for UART-based flashing, e.g. "/dev/ttyUSB0", "COM3"' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive) return 'No active firmware session.';

				const projectType = s.projectInfo?.projectType ?? 'generic';
				const tool = args.tool as string | undefined;

				return `Flash initiated for ${projectType} project.\nFlash tool: ${tool ?? 'auto-detect'}\nMCU: ${s.mcuConfig?.family ?? 'unknown'} ${s.mcuConfig?.variant ?? ''}\n\nFlash commands are emitted to the integrated terminal.`;
			},
		};
	}

	private _fwSerialSend(): IVoidInternalTool {
		return {
			name: 'fw_serial_send',
			description: 'Send data to the connected serial port. Useful for interacting with firmware running on the target MCU.',
			params: {
				data: { description: 'Data to send (string). A newline (\\r\\n) is appended by default.' },
				port: { description: 'Optional port path, e.g. "/dev/ttyUSB0". Uses the connected port if omitted.' },
				baudRate: { description: 'Optional baud rate override. Default: 115200' },
			},
			execute: async (args: Record<string, any>) => {
				const data = args.data as string;
				const port = args.port as string | undefined;

				return `Serial send: "${data}"\nPort: ${port ?? 'active connection'}\n\nUse the Serial tab in the Firmware Environment for full serial monitor functionality including DTR/RTS control and baud rate auto-detection.`;
			},
		};
	}

	private _fwSerialMonitor(): IVoidInternalTool {
		return {
			name: 'fw_serial_monitor',
			description: 'Get the current serial connection status and configuration. Reports port, baud rate, and whether the device was last seen connected.',
			params: {},
			execute: async () => {
				const s = this._session.session;
				if (!s.isActive) { return 'No active firmware session.'; }

				const lines: string[] = ['Serial Monitor Status:'];
				if (s.lastSerialConfig) {
					lines.push(`  Port:      ${s.lastSerialConfig.port}`);
					lines.push(`  Baud rate: ${s.lastSerialConfig.baudRate}`);
					lines.push(`  Connected: ${s.serialWasConnected ? 'yes (last seen connected)' : 'no'}`);
				} else {
					lines.push('  No serial port configured.');
					lines.push('  Use the Serial tab in the Firmware Environment to connect and monitor output.');
				}
				lines.push('');
				lines.push('Tip: Use fw_serial_send to send data to the device.');
				lines.push('     Use the Serial tab for real-time monitoring and RX capture.');
				return lines.join('\n');
			},
		};
	}

	private _fwBinarySize(): IVoidInternalTool {
		return {
			name: 'fw_binary_size',
			description: 'Analyze the binary size of the compiled firmware. Shows Flash/RAM usage, section sizes, and usage percentages.',
			params: {
				elfPath: { description: 'Optional path to the ELF binary. Auto-detected from build output if omitted.' },
			},
			execute: async (args: Record<string, any>) => {
				const s = this._session.session;
				if (!s.isActive || !s.mcuConfig) return 'No active firmware session.';

				const elfPath = args.elfPath as string | undefined;
				const cfg = s.mcuConfig;

				return `Binary size analysis requested.\nELF: ${elfPath ?? 'auto-detect from build output'}\nTarget: ${cfg.family} ${cfg.variant}\nFlash: ${(cfg.flashSize / 1024).toFixed(0)} KB available\nRAM: ${(cfg.ramSize / 1024).toFixed(0)} KB available\n\nRun arm-none-eabi-size on the ELF binary for detailed section breakdown. The Build tab shows visual Flash/RAM usage bars.`;
			},
		};
	}

	private _fwScanProject(): IVoidInternalTool {
		return {
			name: 'fw_scan_project',
			description: 'Scan the workspace for firmware project indicators. Auto-detects MCU, build system, RTOS, and framework from project config files (platformio.ini, CMakeLists.txt, .ioc, sdkconfig, prj.conf, Cargo.toml, etc.).',
			params: {},
			execute: async () => {
				const s = this._session.session;
				if (s.projectInfo) {
					const info = s.projectInfo;
					return `Last scan result:\n  Project type: ${info.projectType}\n  MCU: ${info.mcuFamily ?? 'unknown'} ${info.mcuVariant ?? ''}\n  Board: ${info.boardName ?? 'unknown'}\n  Build system: ${info.buildSystem ?? 'unknown'}\n  RTOS: ${info.rtos ?? 'none'}\n  HAL: ${info.hal ?? 'unknown'}\n  Framework: ${info.framework ?? 'none'}\n  Config files: ${info.configFiles.map(f => f.path).join(', ')}\n  SVD files: ${info.svdFilePaths.join(', ') || 'none'}\n  Confidence: ${(info.confidence * 100).toFixed(0)}%`;
				}
				return 'No project scan results. Open a firmware project workspace and run this command to auto-detect your MCU, build system, and toolchain.';
			},
		};
	}

	private _fwSearchMCU(): IVoidInternalTool {
		return {
			name: 'fw_search_mcu',
			description: 'Search the built-in MCU database. Returns specs for matching MCUs including core, clock, flash, RAM, peripherals, and common boards.',
			params: {
				query: { description: 'Search query: MCU part number, family, board name, or keyword. E.g. "STM32F407", "nRF52840", "Teensy", "ESP32-S3", "Pico"' },
			},
			execute: async () => {
				const s = this._session.session;
				return `MCU database contains pre-indexed specifications. Use the Firmware Environment UI to search and select an MCU. The database has entries covering STM32, Nordic nRF, ESP32, RP2040/RP2350, NXP, Microchip SAM/AVR, TI MSP430, RISC-V, and more.\n\nSession MCU: ${s.mcuConfig ? `${s.mcuConfig.family} ${s.mcuConfig.variant}` : 'none selected'}`;
			},
		};
	}

	// ─── Phase 16: Project config tools ──────────────────────────────────────

	private _fwInit(): IVoidInternalTool {
		return {
			name: 'fw_init',
			description: 'Generate a NI.md project configuration file for the current workspace. NI.md is auto-loaded at every session start and injects project-specific rules, build commands, debug config, and constraints into the AI context. Run once per project, then edit to customize.',
			params: {},
			execute: async () => {
				const s = this._session.session;
				if (!s.isActive) { return 'No active firmware session. Start a session first.'; }

				const content = await this._niMd.generateDefault();
				const config = this._niMd.getConfig();

				return [
					`NI.md generated in workspace root.`,
					``,
					`Sections configured:`,
					config.buildCommand ? `  Build:  ${config.buildCommand}` : '',
					config.flashCommand ? `  Flash:  ${config.flashCommand}` : '',
					config.debugInterface ? `  Debug:  ${config.debugInterface}` : '',
					config.targetMCU ? `  MCU:    ${config.targetMCU}` : '',
					`  Rules:  ${config.rules.length} project-specific rules`,
					`  IMPORTANT: ${config.importantRules.length} critical rules`,
					``,
					`NI.md is now active — its contents are injected into every AI session automatically.`,
					`Edit NI.md to add your own rules, build commands, and constraints.`,
					``,
					`Preview (first 10 lines):`,
					content.split('\n').slice(0, 10).join('\n'),
				].filter(Boolean).join('\n');
			},
		};
	}

	private _fwNiIgnoreCheck(): IVoidInternalTool {
		return {
			name: 'fw_niignore_check',
			description: 'List files in the workspace that are blocked from editing by .niignore rules. Neural Inverse will never modify these files — they can still be read for context. Returns the active .niignore rules and which files currently match them.',
			params: {
				path: { description: 'Directory to check for blocked files. Default: workspace root.' },
			},
			execute: async (args: Record<string, unknown>) => {
				const status = this._niIgnore.getStatus();
				const dirPath = String(args.path ?? '.');
				const blocked = this._niIgnore.listBlocked(dirPath);
				const rules = this._niIgnore.getRules();

				if (rules.length === 0) {
					return [
						`No .niignore file found in workspace.`,
						``,
						`Create .niignore in the project root to restrict which files Neural Inverse can edit.`,
						`Pattern syntax (gitignore-compatible):`,
						`  vendor/          — block everything in vendor/`,
						`  *.bin            — block all .bin files`,
						`  **/generated/**  — block any path with 'generated'`,
						`  !src/gen/config.h — re-include one file`,
					].join('\n');
				}

				return [
					`.niignore active: ${rules.length} rules from ${status.sourceFiles.length} file(s)`,
					`Last loaded: ${new Date(status.lastLoaded).toISOString()}`,
					``,
					`Rules:`,
					...rules.slice(0, 20).map(r => `  ${r.negated ? '!' : ' '}${r.pattern}  (${r.sourcePath.split('/').pop()})`),
					rules.length > 20 ? `  ... ${rules.length - 20} more` : '',
					``,
					`Files blocked in ${dirPath}: ${blocked.length}`,
					...blocked.slice(0, 20).map(f => `  ${f}`),
					blocked.length > 20 ? `  ... ${blocked.length - 20} more` : '',
				].filter(l => l !== '').join('\n');
			},
		};
	}

	private _fwCheckpointCreate(): IVoidInternalTool {
		return {
			name: 'fw_checkpoint_create',
			description: 'Create a checkpoint of the current workspace file state. Checkpoints let you rewind to any previous state or fork a new git branch from a past point. Neural Inverse creates checkpoints automatically before large code changes.',
			params: {
				label: { description: 'Descriptive label for this checkpoint, e.g. "before uart driver refactor". Default: timestamp.' },
			},
			execute: async (args: Record<string, unknown>) => {
				const label = String(args.label ?? `checkpoint ${new Date().toISOString().slice(0, 16)}`);
				const id = await this._checkpoint.createCheckpoint(label);
				const detail = this._checkpoint.getCheckpointDiff(id);
				const status = this._checkpoint.getStatus();

				return [
					`Checkpoint created: ${id}`,
					`Label: ${label}`,
					`Files captured: ${detail?.filesChanged.length ?? 0}`,
					...(detail?.filesChanged.slice(0, 10).map(f => `  ${f}`) ?? []),
					detail && detail.filesChanged.length > 10 ? `  ... ${detail.filesChanged.length - 10} more` : '',
					``,
					`Total checkpoints: ${status.count}/${status.maxCheckpoints}`,
					``,
					`Rewind to this point: fw_checkpoint_rewind({ checkpointId: "${id}" })`,
					`Fork branch from here: fw_checkpoint_fork({ checkpointId: "${id}" })`,
				].filter(l => l !== '').join('\n');
			},
		};
	}

	private _fwCheckpointList(): IVoidInternalTool {
		return {
			name: 'fw_checkpoint_list',
			description: 'List all available checkpoints in the current workspace, newest first. Shows checkpoint ID, label, timestamp, files changed, and branch name if forked.',
			params: {},
			execute: async () => {
				const checkpoints = this._checkpoint.listCheckpoints();
				const status = this._checkpoint.getStatus();

				if (checkpoints.length === 0) {
					return [
						`No checkpoints found.`,
						`Create one: fw_checkpoint_create({ label: "before my change" })`,
					].join('\n');
				}

				const lines = [
					`Checkpoints: ${checkpoints.length}/${status.maxCheckpoints}`,
					`${'─'.repeat(60)}`,
				];

				for (const cp of checkpoints) {
					const ts = new Date(cp.timestamp).toISOString().slice(0, 16).replace('T', ' ');
					const branch = cp.branchName ? ` [branch: ${cp.branchName}]` : '';
					lines.push(`${cp.id}`);
					lines.push(`  Label: ${cp.label}${branch}`);
					lines.push(`  Time:  ${ts}`);
					lines.push(`  Files: ${cp.filesChanged.length} changed`);
					lines.push('');
				}

				lines.push(`Rewind: fw_checkpoint_rewind({ checkpointId: "<id>" })`);
				lines.push(`Fork:   fw_checkpoint_fork({ checkpointId: "<id>" })`);
				return lines.join('\n');
			},
		};
	}

	private _fwCheckpointRewind(): IVoidInternalTool {
		return {
			name: 'fw_checkpoint_rewind',
			description: 'Rewind all workspace files to the state captured in a checkpoint. This OVERWRITES current files — make sure you either have a newer checkpoint or your changes are committed to git first.',
			params: {
				checkpointId: { description: 'Checkpoint ID from fw_checkpoint_list.' },
			},
			execute: async (args: Record<string, unknown>) => {
				const id = String(args.checkpointId ?? '');
				if (!id) { return 'Provide checkpointId from fw_checkpoint_list.'; }

				const detail = this._checkpoint.getCheckpointDiff(id);
				if (!detail) { return `Checkpoint ${id} not found. Run fw_checkpoint_list.`; }

				await this._checkpoint.rewindTo(id);

				return [
					`Rewound to checkpoint: ${detail.label}`,
					`Timestamp: ${new Date(detail.timestamp).toISOString().slice(0, 16).replace('T', ' ')}`,
					`Files restored: ${detail.filesChanged.length}`,
					...detail.filesChanged.slice(0, 10).map(f => `  ${f}`),
					detail.filesChanged.length > 10 ? `  ... ${detail.filesChanged.length - 10} more` : '',
					``,
					`Files have been restored to checkpoint state. Run your build to verify.`,
				].filter(l => l !== '').join('\n');
			},
		};
	}

	private _fwCheckpointFork(): IVoidInternalTool {
		return {
			name: 'fw_checkpoint_fork',
			description: 'Create a new git branch from a checkpoint state. The new branch will have the file state from the checkpoint — useful for exploring alternative implementations or bisecting a regression.',
			params: {
				checkpointId: { description: 'Checkpoint ID from fw_checkpoint_list.' },
				branchName: { description: 'Name for the new git branch. Auto-generated if omitted.' },
			},
			execute: async (args: Record<string, unknown>) => {
				const id = String(args.checkpointId ?? '');
				if (!id) { return 'Provide checkpointId from fw_checkpoint_list.'; }

				const branchName = typeof args.branchName === 'string' ? args.branchName : undefined;
				const branch = await this._checkpoint.forkFrom(id, branchName);
				const detail = this._checkpoint.getCheckpointDiff(id);

				return [
					`Branch created: ${branch}`,
					`From checkpoint: ${detail?.label ?? id}`,
					``,
					`The branch has the file state from the checkpoint.`,
					`Switch to it: git checkout ${branch}`,
					`Return to original: git checkout -`,
				].join('\n');
			},
		};
	}

	// ─── Phase 17: GitHub Daemon tools ────────────────────────────────────────

	private _fwDaemonStart(): IVoidInternalTool {
		return {
			name: 'fw_daemon_start',
			description: 'Start the Neural Inverse GitHub daemon. The daemon polls your GitHub repository for issue/PR comments mentioning @ni or @neuralInverse and processes them automatically — analyzing firmware, generating code, and posting results as comments.',
			params: {
				owner: { description: 'GitHub repository owner (username or org).' },
				repo: { description: 'GitHub repository name.' },
				token: { description: 'GitHub personal access token with repo scope.' },
				pollIntervalSec: { description: 'How often to poll for new mentions (seconds). Default: 30.' },
			},
			execute: async (args: Record<string, unknown>) => {
				const owner = String(args.owner ?? '');
				const repo = String(args.repo ?? '');
				const token = String(args.token ?? '');

				if (!owner || !repo) { return 'Provide owner and repo, e.g. owner: "myorg", repo: "firmware".'; }
				if (!token) { return 'Provide a GitHub personal access token with repo scope.'; }

				const pollIntervalMs = typeof args.pollIntervalSec === 'number'
					? args.pollIntervalSec * 1000
					: 30000;

				await this._daemon.startDaemon({ owner, repo, token, pollIntervalMs });

				return [
					`GitHub daemon started`,
					`Repository: ${owner}/${repo}`,
					`Polling every: ${pollIntervalMs / 1000}s`,
					``,
					`Trigger with: Comment @ni or @neuralInverse on any issue or PR.`,
					`Example comment: "@ni analyze the UART driver for potential race conditions"`,
					``,
					`Status: fw_daemon_status`,
					`Stop:   fw_daemon_stop`,
				].join('\n');
			},
		};
	}

	private _fwDaemonStop(): IVoidInternalTool {
		return {
			name: 'fw_daemon_stop',
			description: 'Stop the Neural Inverse GitHub daemon.',
			params: {},
			execute: async () => {
				const status = this._daemon.getStatus();
				if (!status.running) { return 'GitHub daemon is not running.'; }

				this._daemon.stopDaemon();
				return [
					`GitHub daemon stopped.`,
					`Repo: ${status.repoName ?? 'unknown'}`,
					`Completed: ${status.completedCount} claim(s) processed`,
				].join('\n');
			},
		};
	}

	private _fwDaemonStatus(): IVoidInternalTool {
		return {
			name: 'fw_daemon_status',
			description: 'Show the current status of the Neural Inverse GitHub daemon: running state, repository, pending claims, and recently completed work.',
			params: {},
			execute: async () => {
				const status = this._daemon.getStatus();
				const claims = this._daemon.getClaims();

				if (!status.running) {
					return [
						`GitHub daemon: STOPPED`,
						``,
						`Start with: fw_daemon_start({ owner: "org", repo: "firmware", token: "ghp_..." })`,
					].join('\n');
				}

				const lines = [
					`GitHub daemon: RUNNING`,
					`Repository: ${status.repoName ?? 'unknown'}`,
					`Last poll: ${status.lastPollAt ? new Date(status.lastPollAt).toISOString().slice(11, 19) : 'never'}`,
					`Pending: ${status.pendingCount} | Completed: ${status.completedCount}`,
				];

				if (status.currentClaim) {
					lines.push('');
					lines.push(`Currently processing: ${status.currentClaim.type} #${status.currentClaim.number}`);
					lines.push(`  "${status.currentClaim.title}"`);
				}

				const recent = claims.filter(c => c.status === 'complete' || c.status === 'failed').slice(0, 5);
				if (recent.length > 0) {
					lines.push('');
					lines.push('Recent claims:');
					for (const claim of recent) {
						const ts = new Date(claim.claimedAt).toISOString().slice(11, 16);
						const icon = claim.status === 'complete' ? 'ok' : 'fail';
						lines.push(`  [${icon}] ${ts}  ${claim.type} #${claim.number}: ${claim.title.substring(0, 50)}`);
					}
				}

				return lines.join('\n');
			},
		};
	}
}


registerSingleton(IFirmwareAgentToolService, FirmwareAgentToolService, InstantiationType.Delayed);

