/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Build System Service
 *
 * Integrates with embedded firmware build systems to provide:
 *   - Build, clean, flash commands through IDE
 *   - Binary size analysis (Flash/RAM usage)
 *   - Build error parsing and diagnostics
 *   - Flash programming via OpenOCD, STM32CubeProgrammer, esptool, etc.
 *
 * Supports:
 *   - PlatformIO (pio run, pio upload)
 *   - CMake with arm-none-eabi-gcc
 *   - Make with embedded toolchains
 *   - ESP-IDF (idf.py build, idf.py flash)
 *   - Cargo (cargo build --target thumbv7em-none-eabihf)
 *   - Arduino CLI (arduino-cli compile, arduino-cli upload)
 *   - Zephyr (west build, west flash)
 */

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import {
	IBuildResult,
	IBuildDiagnostic,
	IFlashConfig,
	FirmwareProjectType,
} from '../../../common/firmwareTypes.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { ITerminalService } from '../../../../terminal/browser/terminal.js';
import { TerminalLocation } from '../../../../../../platform/terminal/common/terminal.js';
import { runProcess, isProcessAvailable } from '../utils/processRunner.js';


// ─── Service interface ────────────────────────────────────────────────────────

export const IBuildSystemService = createDecorator<IBuildSystemService>('buildSystemService');

export interface IBuildSystemService {
	readonly _serviceBrand: undefined;

	/** Fires when a build starts. */
	readonly onBuildStarted: Event<IBuildEvent>;
	/** Fires on build progress (stderr/stdout lines). */
	readonly onBuildOutput: Event<IBuildOutputLine>;
	/** Fires when a build completes. */
	readonly onBuildCompleted: Event<IBuildResult>;
	/** Fires when a flash operation starts. */
	readonly onFlashStarted: Event<void>;
	/** Fires when a flash operation completes. */
	readonly onFlashCompleted: Event<IFlashResult>;

	/** Whether a build is currently in progress. */
	readonly isBuilding: boolean;
	/** Whether a flash operation is currently in progress. */
	readonly isFlashing: boolean;
	/** Last build result (undefined if no build has been run). */
	readonly lastBuildResult: IBuildResult | undefined;

	/**
	 * Build the firmware project.
	 * @param projectRoot Workspace folder URI
	 * @param projectType Detected project type
	 * @param target Build target (e.g. "debug", "release", specific env)
	 */
	build(projectRoot: string, projectType: FirmwareProjectType, target?: string): Promise<IBuildResult>;

	/**
	 * Clean build artifacts.
	 */
	clean(projectRoot: string, projectType: FirmwareProjectType): Promise<void>;

	/**
	 * Flash the firmware to the target device.
	 * @param projectRoot Workspace folder URI
	 * @param projectType Detected project type
	 * @param flashConfig Flash tool configuration
	 */
	flash(projectRoot: string, projectType: FirmwareProjectType, flashConfig?: IFlashConfig): Promise<IFlashResult>;

	/**
	 * Analyze binary size (Flash/RAM usage).
	 * @param elfPath Path to the ELF binary
	 * @param mcuFlashSize Total flash size in bytes
	 * @param mcuRamSize Total RAM size in bytes
	 */
	analyzeBinarySize(elfPath: string, mcuFlashSize: number, mcuRamSize: number): Promise<IBinarySizeAnalysis>;

	/**
	 * Get the build command that would be run for a given project type.
	 * Useful for UI display and user customization.
	 */
	getBuildCommand(projectType: FirmwareProjectType, target?: string): string[];

	/**
	 * Get the flash command that would be run for a given project type.
	 */
	getFlashCommand(projectType: FirmwareProjectType, flashConfig?: IFlashConfig): string[];

	/**
	 * Detect available flash tools on the system.
	 */
	detectFlashTools(): Promise<IFlashToolInfo[]>;

	/**
	 * Check whether the required toolchain for the given project type is installed.
	 * Returns a list of missing tools.
	 */
	checkToolchain(projectType: FirmwareProjectType): Promise<IToolchainCheckResult>;

	/**
	 * Parse structured build diagnostics from raw compiler output.
	 * Supports GCC, Clang, IAR, Keil ARM-CC, MSVC, rustc, and xtensa-gcc formats.
	 */
	parseBuildOutput(output: string): { errors: IBuildDiagnostic[]; warnings: IBuildDiagnostic[] };

	/**
	 * Analyse stack usage files (.su) produced by GCC -fstack-usage.
	 * Returns per-function stack depths and identifies deep call chains.
	 */
	analyzeStackUsage(projectRoot: string): Promise<IStackUsageReport>;

	/**
	 * Run `arm-none-eabi-objdump -d` on the ELF and return disassembly for a function or address range.
	 */
	disassemble(elfPath: string, symbol: string): Promise<IDisassemblyResult>;

	/**
	 * Look up ELF symbols matching a pattern via `nm`.
	 */
	lookupSymbols(elfPath: string, pattern: string): Promise<IElfSymbol[]>;

	/**
	 * Abort a running build or flash operation.
	 */
	abort(): void;
}

/** Build event fired when a build starts. */
export interface IBuildEvent {
	projectRoot: string;
	projectType: FirmwareProjectType;
	target?: string;
	command: string[];
	startTime: number;
}

/** A single line of build output. */
export interface IBuildOutputLine {
	text: string;
	stream: 'stdout' | 'stderr';
	timestamp: number;
}

/** Result of a flash operation. */
export interface IFlashResult {
	success: boolean;
	durationMs: number;
	tool: string;
	message: string;
	/** Verify pass/fail if verification was run */
	verified?: boolean;
}

/** Binary size analysis results. */
export interface IBinarySizeAnalysis {
	/** Total .text (code) section size */
	textSize: number;
	/** Total .data (initialized data) section size */
	dataSize: number;
	/** Total .bss (uninitialized data) section size */
	bssSize: number;
	/** Total flash usage (text + data) */
	flashUsage: number;
	/** Total RAM usage (data + bss) */
	ramUsage: number;
	/** Flash usage as percentage of total */
	flashPercent: number;
	/** RAM usage as percentage of total */
	ramPercent: number;
	/** Per-section breakdown */
	sections: Array<{ name: string; size: number; address: number }>;
}

/** Information about an installed flash tool. */
export interface IFlashToolInfo {
	name: string;
	path: string;
	version?: string;
	supportedInterfaces: string[];
}

/** Toolchain availability check result. */
export interface IToolchainCheckResult {
	available: boolean;
	missing: Array<{ tool: string; purpose: string; installHint: string }>;
	found: Array<{ tool: string; path: string; version: string }>;
}

/** Stack usage analysis report. */
export interface IStackUsageReport {
	functions: IFunctionStackUsage[];
	maxStack: number;
	maxStackFunction: string;
	deepChains: Array<{ chain: string[]; totalBytes: number }>;
}

export interface IFunctionStackUsage {
	file: string;
	function: string;
	bytes: number;
	qualifier: 'static' | 'dynamic' | 'dynamic,bounded' | 'unbounded';
}

/** Disassembly result for a function or address range. */
export interface IDisassemblyResult {
	symbol: string;
	address: number;
	lines: IDisassemblyLine[];
	sizeBytes: number;
}

export interface IDisassemblyLine {
	address: number;
	hex: string;
	mnemonic: string;
	operands: string;
	comment?: string;
}

/** ELF symbol from nm output. */
export interface IElfSymbol {
	name: string;
	address: number;
	size?: number;
	type: 'function' | 'object' | 'section' | 'file' | 'unknown';
	binding: 'local' | 'global' | 'weak';
	section: string;
}


// ─── Build command templates ──────────────────────────────────────────────────

const BUILD_COMMANDS: Record<FirmwareProjectType, { build: string[]; clean: string[]; flash: string[] }> = {
	'firmware-inverse': { build: ['make', '-j$(nproc)'],             clean: ['make', 'clean'],                                  flash: ['openocd', '-f', 'interface/stlink.cfg', '-c', 'program *.elf verify reset exit'] },
	'platformio':       { build: ['pio', 'run'],                     clean: ['pio', 'run', '--target', 'clean'],                flash: ['pio', 'run', '--target', 'upload'] },
	'esp-idf':          { build: ['idf.py', 'build'],                clean: ['idf.py', 'fullclean'],                            flash: ['idf.py', 'flash'] },
	'zephyr':           { build: ['west', 'build'],                  clean: ['west', 'build', '--pristine'],                    flash: ['west', 'flash'] },
	'cmake-embedded':   { build: ['cmake', '--build', 'build'],      clean: ['cmake', '--build', 'build', '--target', 'clean'], flash: ['openocd', '-f', 'interface/stlink.cfg', '-f', 'target/stm32f4x.cfg', '-c', 'program build/*.elf verify reset exit'] },
	'make-embedded':    { build: ['make', '-j$(nproc)'],             clean: ['make', 'clean'],                                  flash: ['make', 'flash'] },
	'rust-embedded':    { build: ['cargo', 'build', '--release'],    clean: ['cargo', 'clean'],                                 flash: ['probe-rs', 'run', '--release'] },
	'arduino':          { build: ['arduino-cli', 'compile'],         clean: ['arduino-cli', 'compile', '--clean'],              flash: ['arduino-cli', 'upload'] },
	'mbed':             { build: ['mbed', 'compile'],                clean: ['mbed', 'compile', '--clean'],                     flash: ['mbed', 'compile', '--flash'] },
	'stm32cubeide':     { build: ['make', '-j$(nproc)', '-C', 'Debug'], clean: ['make', 'clean', '-C', 'Debug'],                flash: ['st-flash', 'write', 'Debug/*.bin', '0x08000000'] },
	'stm32cubemx':      { build: ['make', '-j$(nproc)'],             clean: ['make', 'clean'],                                  flash: ['openocd', '-f', 'interface/stlink.cfg', '-f', 'target/stm32f4x.cfg', '-c', 'program build/*.elf verify reset exit'] },
	'generic':          { build: ['make'],                           clean: ['make', 'clean'],                                  flash: ['openocd', '-f', 'interface/stlink.cfg', '-c', 'program *.elf verify reset exit'] },
};

// ─── Toolchain requirements per project type ──────────────────────────────────

const TOOLCHAIN_REQUIREMENTS: Record<FirmwareProjectType, Array<{ tool: string; purpose: string; installHint: string }>> = {
	'firmware-inverse':  [{ tool: 'arm-none-eabi-gcc', purpose: 'ARM cross-compiler', installHint: 'brew install arm-none-eabi-gcc  OR  apt install gcc-arm-none-eabi' }, { tool: 'make', purpose: 'Build system', installHint: 'brew install make  OR  apt install build-essential' }],
	'platformio':        [{ tool: 'pio', purpose: 'PlatformIO CLI', installHint: 'pip install platformio' }],
	'esp-idf':           [{ tool: 'idf.py', purpose: 'ESP-IDF build tool', installHint: 'Install ESP-IDF: https://docs.espressif.com/en/latest/esp32/get-started' }],
	'zephyr':            [{ tool: 'west', purpose: 'Zephyr meta-tool', installHint: 'pip install west' }, { tool: 'cmake', purpose: 'CMake build generator', installHint: 'brew install cmake  OR  apt install cmake' }],
	'cmake-embedded':    [{ tool: 'cmake', purpose: 'CMake build generator', installHint: 'brew install cmake' }, { tool: 'arm-none-eabi-gcc', purpose: 'ARM cross-compiler', installHint: 'brew install arm-none-eabi-gcc' }, { tool: 'ninja', purpose: 'Ninja build system', installHint: 'brew install ninja' }],
	'make-embedded':     [{ tool: 'make', purpose: 'GNU Make', installHint: 'brew install make  OR  apt install build-essential' }, { tool: 'arm-none-eabi-gcc', purpose: 'ARM cross-compiler', installHint: 'brew install arm-none-eabi-gcc' }],
	'rust-embedded':     [{ tool: 'cargo', purpose: 'Rust build system', installHint: 'curl https://sh.rustup.rs -sSf | sh' }, { tool: 'probe-rs', purpose: 'Rust embedded flash/debug', installHint: 'cargo install probe-rs --features cli' }],
	'arduino':           [{ tool: 'arduino-cli', purpose: 'Arduino CLI', installHint: 'brew install arduino-cli  OR  https://arduino.github.io/arduino-cli' }],
	'mbed':              [{ tool: 'mbed', purpose: 'Mbed CLI', installHint: 'pip install mbed-cli' }, { tool: 'arm-none-eabi-gcc', purpose: 'ARM cross-compiler', installHint: 'brew install arm-none-eabi-gcc' }],
	'stm32cubeide':      [{ tool: 'make', purpose: 'GNU Make', installHint: 'apt install build-essential' }, { tool: 'arm-none-eabi-gcc', purpose: 'ARM cross-compiler', installHint: 'apt install gcc-arm-none-eabi' }],
	'stm32cubemx':       [{ tool: 'make', purpose: 'GNU Make', installHint: 'apt install build-essential' }, { tool: 'arm-none-eabi-gcc', purpose: 'ARM cross-compiler', installHint: 'apt install gcc-arm-none-eabi' }],
	'generic':           [{ tool: 'make', purpose: 'GNU Make', installHint: 'brew install make  OR  apt install build-essential' }],
};

// Flash tool detection commands
const FLASH_TOOL_DETECTORS: Array<{ name: string; command: string; versionArg: string; interfaces: string[] }> = [
	{ name: 'openocd',                  command: 'openocd',                  versionArg: '--version',     interfaces: ['swd', 'jtag'] },
	{ name: 'stm32-programmer-cli',     command: 'STM32_Programmer_CLI',     versionArg: '--version',     interfaces: ['swd', 'jtag', 'uart', 'usb'] },
	{ name: 'st-flash',                 command: 'st-flash',                 versionArg: '--version',     interfaces: ['swd'] },
	{ name: 'esptool',                  command: 'esptool.py',               versionArg: 'version',       interfaces: ['uart', 'usb'] },
	{ name: 'nrfjprog',                 command: 'nrfjprog',                 versionArg: '--version',     interfaces: ['swd', 'jtag'] },
	{ name: 'jlink',                    command: 'JLinkExe',                 versionArg: '-CommandFile /dev/null', interfaces: ['swd', 'jtag'] },
	{ name: 'pyocd',                    command: 'pyocd',                    versionArg: '--version',     interfaces: ['swd'] },
	{ name: 'probe-rs',                 command: 'probe-rs',                 versionArg: '--version',     interfaces: ['swd', 'jtag'] },
	{ name: 'dfu-util',                 command: 'dfu-util',                 versionArg: '--version',     interfaces: ['dfu'] },
	{ name: 'arduino-cli',              command: 'arduino-cli',              versionArg: 'version',       interfaces: ['uart', 'usb'] },
	{ name: 'west',                     command: 'west',                     versionArg: '--version',     interfaces: ['swd', 'jtag'] },
];


// ─── Implementation ───────────────────────────────────────────────────────────

class BuildSystemService extends Disposable implements IBuildSystemService {
	readonly _serviceBrand: undefined;

	private readonly _onBuildStarted = this._register(new Emitter<IBuildEvent>());
	readonly onBuildStarted = this._onBuildStarted.event;

	private readonly _onBuildOutput = this._register(new Emitter<IBuildOutputLine>());
	readonly onBuildOutput = this._onBuildOutput.event;

	private readonly _onBuildCompleted = this._register(new Emitter<IBuildResult>());
	readonly onBuildCompleted = this._onBuildCompleted.event;

	private readonly _onFlashStarted = this._register(new Emitter<void>());
	readonly onFlashStarted = this._onFlashStarted.event;

	private readonly _onFlashCompleted = this._register(new Emitter<IFlashResult>());
	readonly onFlashCompleted = this._onFlashCompleted.event;

	private _isBuilding = false;
	private _isFlashing = false;
	private _lastBuildResult: IBuildResult | undefined;
	private _activeAbortController: AbortController | undefined;

	get isBuilding(): boolean { return this._isBuilding; }
	get isFlashing(): boolean { return this._isFlashing; }
	get lastBuildResult(): IBuildResult | undefined { return this._lastBuildResult; }

	constructor(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		@IFirmwareSessionService _session: IFirmwareSessionService,
		@ITerminalService private readonly _terminalService: ITerminalService,
	) {
		super();
		void _session;
	}

	/** Get or create the shared "Firmware Build" terminal. */
	private async _getTerminal() {
		const existing = this._terminalService.instances.find(t => t.title === 'Firmware Build');
		if (existing) { return existing; }
		return this._terminalService.createTerminal({
			location: TerminalLocation.Panel,
			config: { name: 'Firmware Build', forceShellIntegration: true },
		});
	}

	/** Bring the terminal into view and keep the editor focus. */
	private async _showTerminal(term: Awaited<ReturnType<typeof this._getTerminal>>) {
		this._terminalService.setActiveInstance(term);
		await this._terminalService.focusActiveInstance();
	}

	async build(projectRoot: string, projectType: FirmwareProjectType, target?: string): Promise<IBuildResult> {
		if (this._isBuilding) {
			throw new Error('Build already in progress');
		}

		this._isBuilding = true;
		const startTime = Date.now();
		const command = this.getBuildCommand(projectType, target);

		this._onBuildStarted.fire({ projectRoot, projectType, target, command, startTime });

		try {
			this._onBuildOutput.fire({ text: `$ ${command.join(' ')}`, stream: 'stdout', timestamp: Date.now() });

			if (isProcessAvailable()) {
				// Direct subprocess execution with real output capture
				const proc = await runProcess(command[0]!, command.slice(1), {
					cwd: projectRoot,
					timeoutMs: 120_000,
					onStdout: (line) => this._onBuildOutput.fire({ text: line, stream: 'stdout', timestamp: Date.now() }),
					onStderr: (line) => this._onBuildOutput.fire({ text: line, stream: 'stderr', timestamp: Date.now() }),
				});

				const parsed = this.parseBuildOutput(proc.stdout + '\n' + proc.stderr);
				const result: IBuildResult = {
					success: proc.exitCode === 0,
					durationMs: proc.durationMs,
					errors: parsed.errors,
					warnings: parsed.warnings,
					outputPath: this._findOutputBinary(proc.stdout, projectRoot, projectType),
				};

				this._lastBuildResult = result;
				this._onBuildCompleted.fire(result);
				return result;
			}

			// Fallback: dispatch to integrated terminal (no output capture)
			const term = await this._getTerminal();
			await this._showTerminal(term);
			await term.sendText(`cd "${projectRoot}"`, true);
			await term.sendText(command.join(' '), true);
			const result: IBuildResult = {
				success: true,
				durationMs: Date.now() - startTime,
				errors: [],
				warnings: [],
			};

			this._lastBuildResult = result;
			this._onBuildCompleted.fire(result);
			return result;
		} finally {
			this._isBuilding = false;
		}
	}

	async clean(projectRoot: string, projectType: FirmwareProjectType): Promise<void> {
		const commands = BUILD_COMMANDS[projectType] || BUILD_COMMANDS['generic'];
		const command = commands.clean;
		this._onBuildOutput.fire({ text: `$ ${command.join(' ')}`, stream: 'stdout', timestamp: Date.now() });

		if (isProcessAvailable()) {
			const proc = await runProcess(command[0]!, command.slice(1), {
				cwd: projectRoot,
				timeoutMs: 60_000,
				onStdout: (line) => this._onBuildOutput.fire({ text: line, stream: 'stdout', timestamp: Date.now() }),
				onStderr: (line) => this._onBuildOutput.fire({ text: line, stream: 'stderr', timestamp: Date.now() }),
			});
			if (proc.exitCode !== 0) {
				throw new Error(`Clean failed (exit ${proc.exitCode}): ${proc.stderr.split('\n')[0] ?? ''}`);
			}
			return;
		}

		const term = await this._getTerminal();
		await this._showTerminal(term);
		await term.sendText(`cd "${projectRoot}"`, true);
		await term.sendText(command.join(' '), true);
	}

	async flash(projectRoot: string, projectType: FirmwareProjectType, flashConfig?: IFlashConfig): Promise<IFlashResult> {
		if (this._isFlashing) {
			throw new Error('Flash operation already in progress');
		}

		this._isFlashing = true;
		const startTime = Date.now();
		this._onFlashStarted.fire();
		const tool = flashConfig?.tool ?? this._defaultFlashTool(projectType);

		try {
			const command = this.getFlashCommand(projectType, flashConfig);
			this._onBuildOutput.fire({ text: `$ ${command.join(' ')}`, stream: 'stdout', timestamp: Date.now() });

			if (isProcessAvailable()) {
				const proc = await runProcess(command[0]!, command.slice(1), {
					cwd: projectRoot,
					timeoutMs: 120_000,
					onStdout: (line) => this._onBuildOutput.fire({ text: line, stream: 'stdout', timestamp: Date.now() }),
					onStderr: (line) => this._onBuildOutput.fire({ text: line, stream: 'stderr', timestamp: Date.now() }),
				});

				const success = proc.exitCode === 0 && !proc.timedOut;
				const verified = this._parseFlashVerified(proc.stdout + proc.stderr);
				const result: IFlashResult = {
					success,
					durationMs: proc.durationMs,
					tool,
					message: success ? 'Flash complete' : (proc.stderr.split('\n')[0] ?? 'Flash failed'),
					verified,
				};
				this._onFlashCompleted.fire(result);
				return result;
			}

			// Fallback: terminal dispatch
			const term = await this._getTerminal();
			await this._showTerminal(term);
			await term.sendText(`cd "${projectRoot}"`, true);
			await term.sendText(command.join(' '), true);

			const result: IFlashResult = {
				success: true,
				durationMs: Date.now() - startTime,
				tool,
				message: 'Flash command dispatched to terminal',
			};
			this._onFlashCompleted.fire(result);
			return result;
		} finally {
			this._isFlashing = false;
		}
	}

	async analyzeBinarySize(elfPath: string, mcuFlashSize: number, mcuRamSize: number): Promise<IBinarySizeAnalysis> {
		if (!isProcessAvailable()) {
			// Terminal-only fallback
			const term = await this._getTerminal();
			await this._showTerminal(term);
			await term.sendText(`arm-none-eabi-size -A -d "${elfPath}"`, true);
			return { textSize: 0, dataSize: 0, bssSize: 0, flashUsage: 0, ramUsage: 0, flashPercent: 0, ramPercent: 0, sections: [] };
		}

		// Try arm-none-eabi-size first, fall back to size
		const sizeTools = ['arm-none-eabi-size', 'riscv32-unknown-elf-size', 'xtensa-esp32-elf-size', 'size'];
		let proc: Awaited<ReturnType<typeof runProcess>> | undefined;

		for (const tool of sizeTools) {
			const result = await runProcess(tool, ['-A', '-d', elfPath], { timeoutMs: 15_000 });
			if (result.exitCode === 0 && result.stdout) {
				proc = result;
				break;
			}
		}

		if (!proc || !proc.stdout) {
			return { textSize: 0, dataSize: 0, bssSize: 0, flashUsage: 0, ramUsage: 0, flashPercent: 0, ramPercent: 0, sections: [] };
		}

		return this._parseSizeOutput(proc.stdout, mcuFlashSize, mcuRamSize);
	}

	getBuildCommand(projectType: FirmwareProjectType, target?: string): string[] {
		const commands = BUILD_COMMANDS[projectType] || BUILD_COMMANDS['generic'];
		const cmd = [...commands.build];

		// Add target/environment for PlatformIO
		if (projectType === 'platformio' && target) {
			cmd.push('-e', target);
		}
		// Add target board for Zephyr
		else if (projectType === 'zephyr' && target) {
			cmd.push('-b', target);
		}
		// Add target for cargo
		else if (projectType === 'rust-embedded' && target) {
			cmd.push('--target', target);
		}

		return cmd;
	}

	getFlashCommand(projectType: FirmwareProjectType, flashConfig?: IFlashConfig): string[] {
		if (flashConfig) {
			return this._buildFlashCommand(flashConfig);
		}
		const commands = BUILD_COMMANDS[projectType] || BUILD_COMMANDS['generic'];
		return [...commands.flash];
	}

	async detectFlashTools(): Promise<IFlashToolInfo[]> {
		if (!isProcessAvailable()) {
			return FLASH_TOOL_DETECTORS.map(d => ({ name: d.name, path: d.command, supportedInterfaces: d.interfaces }));
		}

		const results: IFlashToolInfo[] = [];

		await Promise.all(FLASH_TOOL_DETECTORS.map(async (detector) => {
			const whichResult = await runProcess('which', [detector.command], { timeoutMs: 3000 });
			if (whichResult.exitCode !== 0 || !whichResult.stdout) return;

			const toolPath = whichResult.stdout.trim();
			let version: string | undefined;

			// Get version string — best effort
			const versionArgs = detector.versionArg.startsWith('-') ? [detector.versionArg] : detector.versionArg.split(' ');
			const versionResult = await runProcess(toolPath, versionArgs, { timeoutMs: 5000 });
			const versionOutput = (versionResult.stdout + versionResult.stderr).split('\n')[0]?.trim();
			if (versionOutput) {
				const vMatch = versionOutput.match(/(\d+\.\d+[\.\d]*)/);
				version = vMatch ? vMatch[1] : versionOutput.slice(0, 40);
			}

			results.push({ name: detector.name, path: toolPath, version, supportedInterfaces: detector.interfaces });
		}));

		return results;
	}

	async checkToolchain(projectType: FirmwareProjectType): Promise<IToolchainCheckResult> {
		const requirements = TOOLCHAIN_REQUIREMENTS[projectType] ?? TOOLCHAIN_REQUIREMENTS['generic'];
		const missing: IToolchainCheckResult['missing'] = [];
		const found: IToolchainCheckResult['found'] = [];

		if (!isProcessAvailable()) {
			return { available: false, missing: requirements.map(r => ({ ...r })), found: [] };
		}

		await Promise.all(requirements.map(async (req) => {
			const whichResult = await runProcess('which', [req.tool], { timeoutMs: 3000 });
			if (whichResult.exitCode !== 0 || !whichResult.stdout) {
				missing.push({ tool: req.tool, purpose: req.purpose, installHint: req.installHint });
				return;
			}
			const toolPath = whichResult.stdout.trim();
			const verResult = await runProcess(toolPath, ['--version'], { timeoutMs: 3000 });
			const verLine = (verResult.stdout + verResult.stderr).split('\n')[0]?.trim() ?? '';
			const verMatch = verLine.match(/(\d+\.\d+[\.\d]*)/);
			found.push({ tool: req.tool, path: toolPath, version: verMatch ? verMatch[1]! : verLine.slice(0, 30) });
		}));

		return { available: missing.length === 0, missing, found };
	}

	async analyzeStackUsage(projectRoot: string): Promise<IStackUsageReport> {
		const functions: IFunctionStackUsage[] = [];

		if (!isProcessAvailable()) {
			return { functions: [], maxStack: 0, maxStackFunction: '', deepChains: [] };
		}

		// Find all .su files (generated by GCC -fstack-usage)
		const findResult = await runProcess('find', [projectRoot, '-name', '*.su', '-not', '-path', '*/node_modules/*'], { timeoutMs: 10_000 });
		if (findResult.exitCode !== 0 || !findResult.stdout.trim()) {
			return { functions: [], maxStack: 0, maxStackFunction: '', deepChains: [] };
		}

		const suFiles = findResult.stdout.trim().split('\n').filter(Boolean);

		for (const suFile of suFiles) {
			const content = await runProcess('cat', [suFile], { timeoutMs: 5000 });
			if (content.exitCode !== 0) continue;

			// .su format: file.c:line:col:function_name	bytes	qualifier
			for (const line of content.stdout.split('\n')) {
				const m = line.match(/^(.+):(\w+)\s+(\d+)\s+(static|dynamic|dynamic,bounded|unbounded)$/);
				if (!m) continue;
				const parts = m[1]!.split(':');
				const file = parts.slice(0, -2).join(':');
				functions.push({
					file,
					function: m[2]!,
					bytes: parseInt(m[3]!, 10),
					qualifier: m[4]! as IFunctionStackUsage['qualifier'],
				});
			}
		}

		const maxEntry = functions.reduce((a, b) => b.bytes > a.bytes ? b : a, { bytes: 0, function: '', file: '', qualifier: 'static' as const });

		return {
			functions,
			maxStack: maxEntry.bytes,
			maxStackFunction: maxEntry.function,
			deepChains: [], // call-graph analysis requires nm + objdump cross-reference
		};
	}

	async disassemble(elfPath: string, symbol: string): Promise<IDisassemblyResult> {
		if (!isProcessAvailable()) {
			throw new Error('Process execution unavailable.');
		}

		// Try toolchain-specific objdump tools in order
		const objdumpTools = ['arm-none-eabi-objdump', 'riscv32-unknown-elf-objdump', 'xtensa-esp32-elf-objdump', 'objdump'];
		let disasmOutput = '';
		let usedTool = '';

		for (const tool of objdumpTools) {
			const result = await runProcess(tool, ['-d', '--no-show-raw-insn', `--disassemble=${symbol}`, elfPath], { timeoutMs: 30_000 });
			if (result.exitCode === 0 && result.stdout) {
				disasmOutput = result.stdout;
				usedTool = tool;
				break;
			}
		}

		if (!disasmOutput) {
			throw new Error(`Could not disassemble symbol "${symbol}" — no compatible objdump found or symbol not in ELF.`);
		}
		void usedTool;

		const lines: IDisassemblyLine[] = [];
		let startAddress = 0;

		// objdump line: "   8000100:	e92d 4ff0 	push	{r4, r5, r6, r7, r8, r9, sl, fp, lr}"
		const lineRe = /^\s+([0-9a-fA-F]+):\s+((?:[0-9a-fA-F]{2,4}\s?)+)\s+(\w+(?:\.\w+)*)\s*(.*?)(?:;(.*))?$/;
		for (const line of disasmOutput.split('\n')) {
			const m = line.match(lineRe);
			if (!m) continue;
			const address = parseInt(m[1]!, 16);
			if (lines.length === 0) startAddress = address;
			lines.push({
				address,
				hex: m[2]!.trim(),
				mnemonic: m[3]!,
				operands: m[4]?.trim() ?? '',
				comment: m[5]?.trim() || undefined,
			});
		}

		return {
			symbol,
			address: startAddress,
			lines,
			sizeBytes: lines.length > 0 ? (lines[lines.length - 1]!.address - startAddress + 4) : 0,
		};
	}

	async lookupSymbols(elfPath: string, pattern: string): Promise<IElfSymbol[]> {
		if (!isProcessAvailable()) return [];

		const nmTools = ['arm-none-eabi-nm', 'riscv32-unknown-elf-nm', 'nm'];
		let nmOutput = '';

		for (const tool of nmTools) {
			const result = await runProcess(tool, ['--print-size', '--demangle', '-S', elfPath], { timeoutMs: 15_000 });
			if (result.exitCode === 0 && result.stdout) {
				nmOutput = result.stdout;
				break;
			}
		}

		if (!nmOutput) return [];

		const symbols: IElfSymbol[] = [];
		const re = pattern ? new RegExp(pattern, 'i') : null;

		// nm --print-size format: "addr size type name"  or  "addr type name"
		for (const line of nmOutput.split('\n')) {
			const parts = line.trim().split(/\s+/);
			if (parts.length < 3) continue;

			const hasSize = parts.length >= 4 && /^[0-9a-fA-F]{8,16}$/.test(parts[1]!);
			const addr = parseInt(parts[0]!, 16);
			const size = hasSize ? parseInt(parts[1]!, 16) : undefined;
			const typeChar = hasSize ? parts[2]! : parts[1]!;
			const name = (hasSize ? parts.slice(3) : parts.slice(2)).join(' ');

			if (!name || isNaN(addr)) continue;
			if (re && !re.test(name)) continue;

			const type: IElfSymbol['type'] = /^[tT]$/.test(typeChar) ? 'function'
				: /^[dDbBsS]$/.test(typeChar) ? 'object'
				: /^[rR]$/.test(typeChar) ? 'section'
				: /^[fF]$/.test(typeChar) ? 'file'
				: 'unknown';
			const binding: IElfSymbol['binding'] = typeChar === typeChar.toLowerCase() ? 'local'
				: typeChar === 'W' ? 'weak' : 'global';

			symbols.push({ name, address: addr, size, type, binding, section: typeChar });
		}

		return symbols;
	}

	abort(): void {
		this._activeAbortController?.abort();
		this._isBuilding = false;
		this._isFlashing = false;
	}

	// ─── Private helpers ──────────────────────────────────────────────────

	/** Extract the output ELF/BIN path from build output. */
	private _findOutputBinary(buildOutput: string, projectRoot: string, projectType: FirmwareProjectType): string | undefined {
		// PlatformIO: ".pio/build/env/firmware.elf"
		const pioMatch = buildOutput.match(/\.pio[\\/]build[\\/][^\s]+\.elf/);
		if (pioMatch) return `${projectRoot}/${pioMatch[0]}`;

		// CMake: "build/firmware.elf" or absolute path
		const elfMatch = buildOutput.match(/(?:Linking|Output|writing).*?\s+([\w./\\-]+\.elf)/i);
		if (elfMatch) return elfMatch[1]!.startsWith('/') ? elfMatch[1] : `${projectRoot}/${elfMatch[1]}`;

		// STM32CubeIDE: "Debug/projectname.elf"
		const stmMatch = buildOutput.match(/\b(\w+[\\/]\w+\.elf)\b/);
		if (stmMatch) return `${projectRoot}/${stmMatch[1]}`;

		// ESP-IDF: "build/project.bin"
		const espMatch = buildOutput.match(/\bProject build complete\.\s*To flash.*?run:\s*(\S+)/i);
		if (espMatch) return espMatch[1];

		// Cargo: "target/.../firmware"
		const cargoMatch = buildOutput.match(/Compiling.*\n.*Finished.*\(target\/[^)]+\)/);
		if (cargoMatch) return undefined; // probe-rs locates it automatically

		void projectType;
		return undefined;
	}

	/** Check if flash output contains a successful verify marker. */
	private _parseFlashVerified(output: string): boolean | undefined {
		if (/verified successfully|verify OK|verification successful/i.test(output)) return true;
		if (/verify failed|verification failed/i.test(output)) return false;
		return undefined;
	}

	/** Parse `arm-none-eabi-size -A -d` output into structured analysis. */
	private _parseSizeOutput(output: string, mcuFlashSize: number, mcuRamSize: number): IBinarySizeAnalysis {
		const sections: Array<{ name: string; size: number; address: number }> = [];
		let textSize = 0, dataSize = 0, bssSize = 0;

		// Format: section   size   addr
		// e.g.:   .text     12345  0x08000000
		const lineRe = /^(\.\w+)\s+(\d+)\s+(0x[0-9a-fA-F]+|\d+)/gm;
		let m: RegExpExecArray | null;
		while ((m = lineRe.exec(output)) !== null) {
			const name = m[1]!;
			const size = parseInt(m[2]!, 10);
			const address = parseInt(m[3]!, 16);
			sections.push({ name, size, address });

			if (name === '.text' || name === '.rodata' || name === '.ARM.extab' || name === '.ARM.exidx') {
				textSize += size;
			} else if (name === '.data' || name === '.data_flash') {
				dataSize += size;
			} else if (name === '.bss' || name === '.noinit') {
				bssSize += size;
			}
		}

		const flashUsage = textSize + dataSize;
		const ramUsage = dataSize + bssSize;
		const flashPercent = mcuFlashSize > 0 ? (flashUsage / mcuFlashSize) * 100 : 0;
		const ramPercent = mcuRamSize > 0 ? (ramUsage / mcuRamSize) * 100 : 0;

		return { textSize, dataSize, bssSize, flashUsage, ramUsage, flashPercent, ramPercent, sections };
	}

	private _buildFlashCommand(config: IFlashConfig): string[] {
		switch (config.tool) {
			case 'openocd':
				return [
					'openocd',
					...(config.interface === 'swd' ? ['-f', 'interface/stlink-v2.cfg'] : ['-f', 'interface/jlink.cfg']),
					...(config.target ? ['-f', `target/${config.target}.cfg`] : []),
					'-c', `program ${config.extraArgs?.[0] ?? '*.elf'} verify reset exit`,
				];

			case 'stm32-programmer-cli':
				return [
					'STM32_Programmer_CLI',
					'-c', `port=${config.interface?.toUpperCase() ?? 'SWD'}`,
					'-w', config.extraArgs?.[0] ?? '*.elf',
					'-v',
					'-rst',
				];

			case 'esptool':
				return [
					'esptool.py',
					'--port', config.extraArgs?.[0] ?? '/dev/ttyUSB0',
					'--baud', '460800',
					'write_flash',
					'0x0',
					config.extraArgs?.[1] ?? 'build/*.bin',
				];

			case 'nrfjprog':
				return [
					'nrfjprog',
					'--program', config.extraArgs?.[0] ?? '*.hex',
					'--verify',
					'--reset',
				];

			case 'jlink':
				return [
					'JLinkExe',
					'-device', config.target ?? 'STM32F407VG',
					'-if', config.interface?.toUpperCase() ?? 'SWD',
					'-speed', '4000',
					'-CommandFile', config.extraArgs?.[0] ?? 'flash.jlink',
				];

			case 'pyocd':
				return [
					'pyocd',
					'flash',
					...(config.target ? ['-t', config.target] : []),
					config.extraArgs?.[0] ?? '*.elf',
				];

			case 'dfu-util':
				return [
					'dfu-util',
					'-a', '0',
					'-D', config.extraArgs?.[0] ?? '*.bin',
					'-s', '0x08000000:leave',
				];

			default:
				return ['echo', `Unknown flash tool: ${config.tool}`];
		}
	}

	private _defaultFlashTool(projectType: FirmwareProjectType): string {
		switch (projectType) {
			case 'platformio': return 'platformio';
			case 'esp-idf': return 'esptool';
			case 'zephyr': return 'west';
			case 'rust-embedded': return 'probe-rs';
			case 'arduino': return 'arduino-cli';
			default: return 'openocd';
		}
	}

	/**
	 * Parse GCC diagnostic output into structured IBuildDiagnostic[].
	 * Handles formats from arm-none-eabi-gcc, xtensa-esp32-elf-gcc, riscv32-unknown-elf-gcc.
	 */
	parseBuildOutput(output: string): { errors: IBuildDiagnostic[]; warnings: IBuildDiagnostic[] } {
		const errors: IBuildDiagnostic[] = [];
		const warnings: IBuildDiagnostic[] = [];

		// GCC format: file.c:42:10: error: expected ';' before '}' token
		const gccRegex = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.+)$/gm;
		let match: RegExpExecArray | null;

		while ((match = gccRegex.exec(output)) !== null) {
			const diagnostic: IBuildDiagnostic = {
				file: match[1],
				line: parseInt(match[2]),
				column: parseInt(match[3]),
				severity: match[4] as 'error' | 'warning' | 'note',
				message: match[5],
			};

			if (diagnostic.severity === 'error') {
				errors.push(diagnostic);
			} else {
				warnings.push(diagnostic);
			}
		}

		// Linker: undefined reference
		const linkerRegex = /^(.+?):(\d+):\s+undefined reference to [`'](.+?)['`]/gm;
		while ((match = linkerRegex.exec(output)) !== null) {
			errors.push({ file: match[1]!, line: parseInt(match[2]!), severity: 'error', message: `Undefined reference to '${match[3]}'` });
		}

		// Clang/LLVM: file.c:42:10: error: message (same as GCC — already caught above)

		// IAR: file.c(42) : Error[Pe065]: operation may be undefined
		const iarRegex = /^"?(.+?)"?\((\d+)\)\s*:\s*(Error|Warning)\[([^\]]+)\]:\s*(.+)$/gm;
		while ((match = iarRegex.exec(output)) !== null) {
			const sev = match[3]!.toLowerCase() as 'error' | 'warning';
			const diag: IBuildDiagnostic = { file: match[1]!, line: parseInt(match[2]!), severity: sev, message: `[${match[4]}] ${match[5]}`, code: match[4] };
			sev === 'error' ? errors.push(diag) : warnings.push(diag);
		}

		// Keil ARM-CC: file.c(42): error: #65-D: message
		const keilRegex = /^(.+?)\((\d+)\):\s*(error|warning):\s*#\d+(?:-D)?:\s*(.+)$/gm;
		while ((match = keilRegex.exec(output)) !== null) {
			const sev = match[3]! as 'error' | 'warning';
			const diag: IBuildDiagnostic = { file: match[1]!, line: parseInt(match[2]!), severity: sev, message: match[4]! };
			sev === 'error' ? errors.push(diag) : warnings.push(diag);
		}

		// rustc: error[E0308]: mismatched types  -->  src/main.rs:42:10
		const rustcRegex = /^(error|warning)(?:\[([A-Z0-9]+)\])?:\s*(.+)\n\s+-->\s+(.+?):(\d+):(\d+)/gm;
		while ((match = rustcRegex.exec(output)) !== null) {
			const sev = match[1]! as 'error' | 'warning';
			const diag: IBuildDiagnostic = { file: match[4]!, line: parseInt(match[5]!), column: parseInt(match[6]!), severity: sev, message: match[3]!, code: match[2] };
			sev === 'error' ? errors.push(diag) : warnings.push(diag);
		}

		// PlatformIO / ESP-IDF: FAILED, Error, CMake Error at ...
		const cmakeErrRegex = /^CMake Error at (.+?):(\d+)/gm;
		while ((match = cmakeErrRegex.exec(output)) !== null) {
			errors.push({ file: match[1]!, line: parseInt(match[2]!), severity: 'error', message: 'CMake configuration error' });
		}

		// Dedup by file+line+message
		const seen = new Set<string>();
		const dedup = (arr: IBuildDiagnostic[]): IBuildDiagnostic[] => arr.filter(d => {
			const key = `${d.file}:${d.line}:${d.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		return { errors: dedup(errors), warnings: dedup(warnings) };
	}

	/**
	 * Parse arm-none-eabi-size output into IBinarySizeAnalysis.
	 * Format: text	data	bss	dec	hex	filename
	 */
	parseSizeOutput(output: string, mcuFlashSize: number, mcuRamSize: number): IBinarySizeAnalysis {
		const lines = output.trim().split('\n');
		// Look for the data line (second line, first line is header)
		const dataLine = lines.find(l => /^\s*\d+/.test(l));

		if (!dataLine) {
			return {
				textSize: 0, dataSize: 0, bssSize: 0,
				flashUsage: 0, ramUsage: 0,
				flashPercent: 0, ramPercent: 0,
				sections: [],
			};
		}

		const parts = dataLine.trim().split(/\s+/);
		const textSize = parseInt(parts[0]) || 0;
		const dataSize = parseInt(parts[1]) || 0;
		const bssSize = parseInt(parts[2]) || 0;

		const flashUsage = textSize + dataSize;
		const ramUsage = dataSize + bssSize;

		return {
			textSize,
			dataSize,
			bssSize,
			flashUsage,
			ramUsage,
			flashPercent: mcuFlashSize > 0 ? (flashUsage / mcuFlashSize) * 100 : 0,
			ramPercent: mcuRamSize > 0 ? (ramUsage / mcuRamSize) * 100 : 0,
			sections: [
				{ name: '.text', size: textSize, address: 0x08000000 },
				{ name: '.data', size: dataSize, address: 0x20000000 },
				{ name: '.bss', size: bssSize, address: 0x20000000 + dataSize },
			],
		};
	}
}


registerSingleton(IBuildSystemService, BuildSystemService, InstantiationType.Delayed);
