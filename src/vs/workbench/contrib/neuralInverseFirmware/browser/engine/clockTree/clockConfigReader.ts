/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Clock configuration reader.
 *
 * Reads real PLL values from project source files:
 *   - STM32CubeMX .ioc file     (RCC_OscInitStruct / PLL fields)
 *   - STM32 HAL system_stm32*.c (HSE_VALUE, PLL_M, PLL_N, PLL_P, PLL_Q defines)
 *   - STM32 stm32*_hal_conf.h   (HSE_VALUE, RCC_PLL* macros)
 *   - Zephyr board .conf / .dts (clock-frequency, pll-m, pll-n etc.)
 *   - ESP-IDF sdkconfig          (CONFIG_ESP32_DEFAULT_CPU_FREQ_MHZ)
 *   - Arduino boards.txt        (build.f_cpu)
 *   - Generic: #define PLL_M / #define PLLM patterns
 */

export interface IClockConfig {
	hseMHz?: number;
	m?: number;
	n?: number;
	p?: number;
	q?: number;
	ahbPrescaler?: number;
	apb1Prescaler?: number;
	apb2Prescaler?: number;
	sourceFile?: string;       // which file the values were read from
	confidence: 'high' | 'medium' | 'low';
}

// ---
// Example lines:
//   RCC.PLLDivM=4
//   RCC.PLLMulN=168
//   RCC.PLLDivP=2
//   RCC.PLLDivQ=7
//   RCC.PLLSourceVirtual=RCC_PLLSource_HSE
//   RCC.HSEFreq_Value=8000000
function parseIocFile(text: string): IClockConfig | null {
	const get = (key: string) => {
		const m = new RegExp(`^${key}=(.+)`, 'm').exec(text);
		return m ? m[1]!.trim() : undefined;
	};

	const hseHz = get('RCC.HSEFreq_Value') || get('RCC.HSE_VALUE') || get('RCC.HSEFreq');
	const pllM  = get('RCC.PLLDivM') || get('RCC.PLLM');
	const pllN  = get('RCC.PLLMulN') || get('RCC.PLLN');
	const pllP  = get('RCC.PLLDivP') || get('RCC.PLLP');
	const pllQ  = get('RCC.PLLDivQ') || get('RCC.PLLQ');
	const ahb   = get('RCC.AHBCLKDivider');
	const apb1  = get('RCC.APB1CLKDivider');
	const apb2  = get('RCC.APB2CLKDivider');

	if (!pllM && !pllN) { return null; }

	const prescalerMap: Record<string,number> = {
		'RCC_SYSCLK_DIV1':1,'RCC_SYSCLK_DIV2':2,'RCC_SYSCLK_DIV4':4,
		'RCC_SYSCLK_DIV8':8,'RCC_SYSCLK_DIV16':16,
		'RCC_HCLK_DIV1':1,'RCC_HCLK_DIV2':2,'RCC_HCLK_DIV4':4,
		'RCC_HCLK_DIV8':8,'RCC_HCLK_DIV16':16,
	};
	const parsePresc = (v?: string) => v ? (prescalerMap[v] || parseInt(v) || 1) : undefined;

	return {
		hseMHz: hseHz ? parseInt(hseHz) / 1e6 : undefined,
		m: pllM  ? parseInt(pllM)  : undefined,
		n: pllN  ? parseInt(pllN)  : undefined,
		p: pllP  ? parseInt(pllP)  : undefined,
		q: pllQ  ? parseInt(pllQ)  : undefined,
		ahbPrescaler:  parsePresc(ahb),
		apb1Prescaler: parsePresc(apb1),
		apb2Prescaler: parsePresc(apb2),
		confidence: 'high',
	};
}

// ---
// Patterns:
//   #define HSE_VALUE    ((uint32_t)8000000U)
//   #define PLL_M      4
//   #define PLL_N      168
//   #define PLL_P      RCC_PLLP_DIV2   or   2
//   #define PLL_Q      7
//   #define PLLM       4          (no space variant)
function parseHalHeader(text: string): IClockConfig | null {
	const defineNum = (names: string[]) => {
		for (const n of names) {
			const m = new RegExp(`#define\\s+${n}\\s+(?:\\(\\s*(?:uint32_t)?\\s*\\()?\\s*(\\d+)`).exec(text);
			if (m) { return parseInt(m[1]!); }
		}
		return undefined;
	};
	const definePDiv = (names: string[]) => {
		for (const n of names) {
			// #define PLL_P RCC_PLLP_DIV2 -> extract 2,4,6,8
			const m = new RegExp(`#define\\s+${n}\\s+(?:RCC_PLLP_DIV)?(\\d+)`).exec(text);
			if (m) { return parseInt(m[1]!); }
		}
		return undefined;
	};

	const hseHz  = defineNum(['HSE_VALUE','HSE_VALUE_']);
	const pllM   = defineNum(['PLL_M','PLLM','RCC_PLL_M','PLL_M_VALUE']);
	const pllN   = defineNum(['PLL_N','PLLN','RCC_PLL_N','PLL_N_VALUE']);
	const pllP   = definePDiv(['PLL_P','PLLP','RCC_PLL_P','PLL_P_VALUE']);
	const pllQ   = defineNum(['PLL_Q','PLLQ','RCC_PLL_Q','PLL_Q_VALUE']);

	if (!pllM && !pllN) { return null; }

	return {
		hseMHz: hseHz ? hseHz / 1e6 : undefined,
		m: pllM, n: pllN, p: pllP, q: pllQ,
		confidence: 'high',
	};
}

// ---
// board.cmake / stm32_soc.h / west.yml patterns:
//   CONFIG_CLOCK_STM32_PLL_M_DIVISOR=4
//   CONFIG_CLOCK_STM32_PLL_N_MULTIPLIER=168
//   CONFIG_CLOCK_STM32_PLL_P_DIVISOR=2
//   CONFIG_CLOCK_STM32_PLL_Q_DIVISOR=7
//   CONFIG_CLOCK_STM32_HSE_CLOCK=8000000
function parseZephyrConfig(text: string): IClockConfig | null {
	const get = (key: string) => {
		const m = new RegExp(`${key}=(\\d+)`).exec(text);
		return m ? parseInt(m[1]!) : undefined;
	};
	const hseHz = get('CONFIG_CLOCK_STM32_HSE_CLOCK') || get('CONFIG_SYS_CLOCK_HW_CYCLES_PER_SEC');
	const pllM  = get('CONFIG_CLOCK_STM32_PLL_M_DIVISOR')    || get('CONFIG_CLOCK_STM32_PLLM');
	const pllN  = get('CONFIG_CLOCK_STM32_PLL_N_MULTIPLIER') || get('CONFIG_CLOCK_STM32_PLLN');
	const pllP  = get('CONFIG_CLOCK_STM32_PLL_P_DIVISOR')    || get('CONFIG_CLOCK_STM32_PLLP');
	const pllQ  = get('CONFIG_CLOCK_STM32_PLL_Q_DIVISOR')    || get('CONFIG_CLOCK_STM32_PLLQ');
	const ahb   = get('CONFIG_CLOCK_STM32_AHB_PRESCALER');
	const apb1  = get('CONFIG_CLOCK_STM32_APB1_PRESCALER');
	const apb2  = get('CONFIG_CLOCK_STM32_APB2_PRESCALER');

	if (!pllM && !pllN) { return null; }

	return {
		hseMHz: hseHz ? hseHz / 1e6 : undefined,
		m: pllM, n: pllN, p: pllP, q: pllQ,
		ahbPrescaler: ahb, apb1Prescaler: apb1, apb2Prescaler: apb2,
		confidence: 'high',
	};
}

// ---
// CONFIG_ESP32_DEFAULT_CPU_FREQ_MHZ=240
// CONFIG_ESP32S3_DEFAULT_CPU_FREQ_MHZ=240
function parseEspIdfConfig(text: string): IClockConfig | null {
	const m = /CONFIG_ESP\w+_DEFAULT_CPU_FREQ_MHZ=(\d+)/.exec(text);
	if (!m) { return null; }
	const mhz = parseInt(m[1]!);
	// Synthesise N from target freq (ESP32 uses 40 MHz XTAL, N=mhz/40*2)
	return {
		hseMHz: 40,
		n: mhz / 40 * 2,
		m: 1, p: 2, q: 4,
		confidence: 'medium',
	};
}

// ---
// nucleo_f446re.build.f_cpu=180000000L
function parseArduinoBoards(text: string, boardName?: string): IClockConfig | null {
	// Try board-specific or generic
	const patterns = boardName
		? [new RegExp(`${boardName}\\.build\\.f_cpu=(\\d+)`,'i'), /build\.f_cpu=(\d+)/]
		: [/build\.f_cpu=(\d+)/];
	for (const pat of patterns) {
		const m = pat.exec(text);
		if (m) {
			return { hseMHz: 8, n: parseInt(m[1]!)/1e6/8*2, m:1, p:2, q:4, confidence:'low' };
		}
	}
	return null;
}

// ---
// Catches any #define PLLM 4 style defines
function parseGenericHeader(text: string): IClockConfig | null {
	const defineNum = (names: string[]) => {
		for (const n of names) {
			const m = new RegExp(`#define\\s+${n}\\s+(\\d+)`).exec(text);
			if (m) { return parseInt(m[1]!); }
		}
		return undefined;
	};
	const m2 = defineNum(['PLLM','PLL_M','PLLDivM','RCC_PLLM']);
	const n2 = defineNum(['PLLN','PLL_N','PLLMulN','RCC_PLLN']);
	if (!m2 && !n2) { return null; }
	return {
		m: m2, n: n2,
		p: defineNum(['PLLP','PLL_P','PLLDivP','RCC_PLLP']),
		q: defineNum(['PLLQ','PLL_Q','PLLDivQ','RCC_PLLQ']),
		hseMHz: (() => {
			const hv = defineNum(['HSE_VALUE']);
			return hv ? hv / 1e6 : undefined;
		})(),
		confidence: 'medium',
	};
}

// ---

export interface IClockConfigFile {
	path: string;
	type: 'cubemx-ioc' | 'hal-header' | 'zephyr-conf' | 'espressif-sdkconfig' | 'arduino-boards' | 'generic-header';
}

/** Given filename, detect which parser to use. */
export function detectFileType(filename: string): IClockConfigFile['type'] | null {
	const n = filename.toLowerCase();
	if (n.endsWith('.ioc')) { return 'cubemx-ioc'; }
	if (n.startsWith('system_stm32') || n === 'stm32_hal_conf.h' || n.endsWith('_hal_conf.h') || n.endsWith('_conf.h')) { return 'hal-header'; }
	if (n === 'prj.conf' || n === 'app.conf' || n === 'build.conf' || n.endsWith('.conf') || n.endsWith('.kconf')) { return 'zephyr-conf'; }
	if (n === 'sdkconfig' || n === 'sdkconfig.defaults') { return 'espressif-sdkconfig'; }
	if (n === 'boards.txt') { return 'arduino-boards'; }
	if (n.endsWith('.h') || n.endsWith('.hpp') || n.endsWith('.c') || n.endsWith('.cpp')) { return 'generic-header'; }
	return null;
}

/** Parse file content given its detected type. Returns null if no PLL config found. */
export function parseClockConfigFile(text: string, type: IClockConfigFile['type'], boardName?: string): IClockConfig | null {
	switch (type) {
		case 'cubemx-ioc':         return parseIocFile(text);
		case 'hal-header':         return parseHalHeader(text);
		case 'zephyr-conf':        return parseZephyrConfig(text);
		case 'espressif-sdkconfig':return parseEspIdfConfig(text);
		case 'arduino-boards':     return parseArduinoBoards(text, boardName);
		case 'generic-header':     return parseGenericHeader(text);
	}
}

/** Merge multiple partial configs, higher confidence wins. */
export function mergeClockConfigs(configs: IClockConfig[]): IClockConfig {
	const byConf: Record<string,number> = { high:3, medium:2, low:1 };
	const sorted = [...configs].sort((a,b) => byConf[b.confidence]! - byConf[a.confidence]!);
	const merged: IClockConfig = { confidence: 'low' };
	for (const cfg of sorted.reverse()) {  // low first, high overwrites
		if (cfg.hseMHz !== undefined) { merged.hseMHz = cfg.hseMHz; }
		if (cfg.m !== undefined) { merged.m = cfg.m; }
		if (cfg.n !== undefined) { merged.n = cfg.n; }
		if (cfg.p !== undefined) { merged.p = cfg.p; }
		if (cfg.q !== undefined) { merged.q = cfg.q; }
		if (cfg.ahbPrescaler  !== undefined) { merged.ahbPrescaler  = cfg.ahbPrescaler; }
		if (cfg.apb1Prescaler !== undefined) { merged.apb1Prescaler = cfg.apb1Prescaler; }
		if (cfg.apb2Prescaler !== undefined) { merged.apb2Prescaler = cfg.apb2Prescaler; }
		if (cfg.sourceFile !== undefined) { merged.sourceFile = cfg.sourceFile; }
		if (byConf[cfg.confidence]! > byConf[merged.confidence]!) { merged.confidence = cfg.confidence; }
	}
	return merged;
}

/** Files to scan for clock config, in priority order. */
export const CLOCK_CONFIG_SCAN_FILES = [
	// CubeMX
	{ glob: '*.ioc',               type: 'cubemx-ioc' as const },
	// STM32 HAL
	{ glob: 'system_stm32*.c',     type: 'hal-header' as const },
	{ glob: '*_hal_conf.h',        type: 'hal-header' as const },
	{ glob: 'stm32*_hal_conf.h',   type: 'hal-header' as const },
	// Zephyr
	{ glob: 'prj.conf',            type: 'zephyr-conf' as const },
	{ glob: 'app.conf',            type: 'zephyr-conf' as const },
	{ glob: 'board.conf',          type: 'zephyr-conf' as const },
	// ESP-IDF
	{ glob: 'sdkconfig',           type: 'espressif-sdkconfig' as const },
	{ glob: 'sdkconfig.defaults',  type: 'espressif-sdkconfig' as const },
	// Arduino
	{ glob: 'boards.txt',          type: 'arduino-boards' as const },
	// Generic fallback headers
	{ glob: 'main.h',              type: 'generic-header' as const },
	{ glob: 'config.h',            type: 'generic-header' as const },
	{ glob: 'clock_config.h',      type: 'generic-header' as const },
	{ glob: 'board.h',             type: 'generic-header' as const },
];
