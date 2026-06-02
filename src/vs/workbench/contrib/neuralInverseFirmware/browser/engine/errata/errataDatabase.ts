/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Built-in errata database — curated silicon errata for common MCU families.
 *
 * Sources: ST errata sheets, Nordic errata docs, ESP errata advisories,
 * RP2040/RP2350 errata, NXP chip errata. These are the high-impact bugs
 * that developers most commonly hit.
 */

import { IErrata } from '../../../common/firmwareTypes.js';


export interface IErrataFamily {
	family: string;
	variants: string[];
	errata: IErrata[];
}

export const BUILTIN_ERRATA: IErrataFamily[] = [
	// ─── STM32F4 ─────────────────────────────────────────────────────────────
	{
		family: 'STM32F4',
		variants: ['STM32F405', 'STM32F407', 'STM32F415', 'STM32F417', 'STM32F427', 'STM32F429', 'STM32F437', 'STM32F439', 'STM32F446', 'STM32F469', 'STM32F479'],
		errata: [
			{
				id: 'ES_STM32F4_2.1.8',
				title: 'I2C analog filter may provide wrong value, locking BUSY flag',
				affectedPeripheral: 'I2C',
				description: 'Under certain conditions, the I2C analog noise filter generates a spurious START condition which locks the I2C bus BUSY flag permanently. The only recovery is a software reset of the I2C peripheral.',
				workaround: 'Implement a BUSY flag timeout and I2C peripheral reset sequence: disable PE, configure SCL as GPIO, toggle 9 clock pulses, reconfigure as AF, re-enable PE. Alternatively, disable the analog filter (ANFOFF=1 in FLTR register) and use the digital filter.',
				severity: 'critical',
				affectedRevisions: ['A', 'Z', '1', '3'],
				documentPage: 18,
			},
			{
				id: 'ES_STM32F4_2.1.10',
				title: 'I2C event/error interrupt may not be generated when ITEVFEN/ITERREN set after START',
				affectedPeripheral: 'I2C',
				description: 'If the ITEVFEN or ITERREN bits in I2C_CR2 are set after the START condition has been sent (SB=1), the interrupt may not be generated for subsequent events.',
				workaround: 'Always set ITEVFEN and ITERREN before sending the START condition (setting the START bit).',
				severity: 'major',
				affectedRevisions: ['A', 'Z', '1', '3'],
				documentPage: 20,
			},
			{
				id: 'ES_STM32F4_2.5.1',
				title: 'DMA2 data corruption when managing AHB and APB peripherals in a concurrent way',
				affectedPeripheral: 'DMA',
				description: 'When DMA2 streams are configured to transfer data from/to APB peripherals and simultaneously another DMA2 stream is managing AHB peripherals, data corruption may occur on the APB transfers.',
				workaround: 'Use FIFO mode with threshold set to "full" for DMA2 streams accessing APB peripherals when other DMA2 streams access AHB peripherals concurrently. Alternatively, avoid concurrent AHB+APB DMA2 usage.',
				severity: 'critical',
				affectedRevisions: ['A', 'Z'],
				fixedInRevision: '1',
				documentPage: 28,
			},
			{
				id: 'ES_STM32F4_2.7.1',
				title: 'Delay after an RCC peripheral clock enabling',
				affectedPeripheral: 'RCC',
				description: 'A delay between an RCC peripheral clock enable and the effective peripheral enabling is required. If not observed, the first read/write access to the peripheral register may be corrupted.',
				workaround: 'Insert a dummy read of the corresponding RCC_AHBxENR register after enabling the peripheral clock. The __HAL_RCC_GPIOx_CLK_ENABLE() macros in HAL already implement this workaround.',
				severity: 'major',
				affectedRevisions: ['A', 'Z', '1', '3', '6'],
				documentPage: 32,
			},
			{
				id: 'ES_STM32F4_2.8.7',
				title: 'UART data corruption when parity is enabled and DMA is used',
				affectedPeripheral: 'USART',
				description: 'When parity is enabled and data is received via DMA, the parity bit may be included in the received data word, causing data corruption.',
				workaround: 'Configure DMA to transfer data in byte mode (MSIZE=00, PSIZE=00) regardless of the USART word length. In software, mask the MSB of each received byte (ANDing with 0x7F for 8-bit data or 0xFF for 9-bit data without parity bit).',
				severity: 'major',
				affectedRevisions: ['A', 'Z', '1'],
				fixedInRevision: '3',
				documentPage: 37,
			},
			{
				id: 'ES_STM32F4_2.3.2',
				title: 'SPI CRC computation incorrect in slave mode with data size ≤ 8 bits',
				affectedPeripheral: 'SPI',
				description: 'In SPI slave mode with CRC enabled and frame size ≤ 8 bits, the CRC value is computed on 16-bit words instead of 8-bit bytes, producing an incorrect CRC.',
				workaround: 'In slave mode with CRC enabled, use 16-bit data frames. Alternatively, disable hardware CRC and implement CRC in software.',
				severity: 'major',
				affectedRevisions: ['A', 'Z', '1', '3'],
				documentPage: 24,
			},
			{
				id: 'ES_STM32F4_2.6.1',
				title: 'TIM1/TIM8 repetition counter not behaving correctly in center-aligned PWM mode',
				affectedPeripheral: 'TIM',
				description: 'In center-aligned mode with repetition counter > 0, the update event (UEV) is generated on each counter overflow/underflow instead of after the programmed number of repetitions.',
				workaround: 'Use edge-aligned mode with two compare channels to simulate center-aligned PWM, or manage the repetition count in software via the update interrupt.',
				severity: 'minor',
				affectedRevisions: ['A', 'Z'],
				fixedInRevision: '1',
				documentPage: 30,
			},
		],
	},

	// ─── STM32L4 ─────────────────────────────────────────────────────────────
	{
		family: 'STM32L4',
		variants: ['STM32L431', 'STM32L432', 'STM32L433', 'STM32L442', 'STM32L443', 'STM32L451', 'STM32L452', 'STM32L462', 'STM32L471', 'STM32L475', 'STM32L476', 'STM32L496'],
		errata: [
			{
				id: 'ES_STM32L4_2.3.1',
				title: 'LPUART cannot wake up from Stop mode with HSI16 clock',
				affectedPeripheral: 'LPUART',
				description: 'When LPUART is clocked by HSI16 and the MCU enters Stop mode, the LPUART WUF flag is set but the MCU does not exit Stop mode.',
				workaround: 'Use LSE as LPUART clock source for wake-up from Stop mode. If HSI16 is required for baud rate, switch to LSE before entering Stop and reconfigure after wake.',
				severity: 'major',
				affectedRevisions: ['1', '2'],
				fixedInRevision: '3',
				documentPage: 14,
			},
			{
				id: 'ES_STM32L4_2.5.3',
				title: 'SRAM2 parity error flag not cleared after reset',
				affectedPeripheral: 'SRAM',
				description: 'The SRAM2 parity error flag (SPE in SYSCFG_CFGR2) may remain set after a system reset, causing spurious NMI if SRAM parity error NMI is enabled.',
				workaround: 'Clear the SPE flag in SYSCFG_CFGR2 during system initialization before enabling SRAM2 parity NMI.',
				severity: 'minor',
				affectedRevisions: ['1'],
				fixedInRevision: '2',
				documentPage: 22,
			},
		],
	},

	// ─── STM32H7 ─────────────────────────────────────────────────────────────
	{
		family: 'STM32H7',
		variants: ['STM32H743', 'STM32H750', 'STM32H753', 'STM32H723', 'STM32H725', 'STM32H730', 'STM32H745', 'STM32H747', 'STM32H755', 'STM32H757'],
		errata: [
			{
				id: 'ES_STM32H7_2.2.9',
				title: 'DMAMUX request generator triggers lost under specific conditions',
				affectedPeripheral: 'DMAMUX',
				description: 'When using DMAMUX request generator with external synchronization signals, trigger events can be missed if they arrive within 1 AHB clock cycle of the DMA transfer completion.',
				workaround: 'Use a timer as an intermediate trigger source with a guard time of at least 2 AHB clock cycles between consecutive trigger events.',
				severity: 'major',
				affectedRevisions: ['V', 'Y'],
				documentPage: 25,
			},
			{
				id: 'ES_STM32H7_2.7.1',
				title: 'Reading from QUADSPI may be corrupted after abort',
				affectedPeripheral: 'QUADSPI',
				description: 'After aborting a QUADSPI read operation (setting ABORT bit in QUADSPI_CR), subsequent read operations may return corrupted data.',
				workaround: 'After issuing an abort, perform a dummy read from QUADSPI then wait for BUSY flag to clear before starting a new operation.',
				severity: 'major',
				affectedRevisions: ['V', 'Y'],
				fixedInRevision: 'X',
				documentPage: 34,
			},
			{
				id: 'ES_STM32H7_2.3.1',
				title: 'Ethernet: frame reception may be corrupted in Cut-through mode',
				affectedPeripheral: 'ETH',
				description: 'In Ethernet Cut-through (CT) mode for reception, frames may be truncated or corrupted when the receive FIFO fills up at line rate.',
				workaround: 'Use Store-and-Forward (SF) mode for Ethernet reception. Set RSF bit in ETH_MTLRQOMR.',
				severity: 'critical',
				affectedRevisions: ['V'],
				fixedInRevision: 'Y',
				documentPage: 18,
			},
		],
	},

	// ─── nRF52 ───────────────────────────────────────────────────────────────
	{
		family: 'nRF52',
		variants: ['nRF52832', 'nRF52833', 'nRF52840', 'nRF52810', 'nRF52811', 'nRF52820'],
		errata: [
			{
				id: 'nRF52_E78',
				title: 'RADIO: MHRMATCH event fires too early',
				affectedPeripheral: 'RADIO',
				description: 'The MHRMATCH event may fire before the full MHR has been received, causing incorrect frame filtering decisions in IEEE 802.15.4 mode.',
				workaround: 'Add a delay of at least 1 byte time (32 µs at 250 kbps) after MHRMATCH before reading the matched frame header.',
				severity: 'major',
				affectedRevisions: ['QFAA-B00', 'QFAB-B00', 'CIAA-B00'],
				documentPage: 45,
			},
			{
				id: 'nRF52_E89',
				title: 'RADIO: anomalous RSSI reading during CCA',
				affectedPeripheral: 'RADIO',
				description: 'During Clear Channel Assessment (CCA), the RSSI peripheral may report an RSSI value that is up to 3 dB higher than the actual signal level.',
				workaround: 'Add a 3 dB margin to the CCA ED threshold. For example, if the standard requires -85 dBm, configure the threshold to -88 dBm.',
				severity: 'minor',
				affectedRevisions: ['QFAA-B00', 'QFAB-B00'],
				documentPage: 52,
			},
			{
				id: 'nRF52_E109',
				title: 'NFCT: FIELDLOST event not raised when expected',
				affectedPeripheral: 'NFCT',
				description: 'In NFC-A mode, the FIELDLOST event may not be raised when the NFC field is removed, leaving the NFCT peripheral in an active state consuming power.',
				workaround: 'Implement a timer-based watchdog that checks FIELDPRESENT register periodically (recommended 100 ms). If field is lost, disable and re-enable the NFCT peripheral.',
				severity: 'major',
				affectedRevisions: ['QFAA-B00', 'QFAB-B00', 'CIAA-B00'],
				documentPage: 58,
			},
			{
				id: 'nRF52_E219',
				title: 'POWER: VBUS detection unreliable after soft reset',
				affectedPeripheral: 'POWER',
				description: 'On nRF52840, after a soft reset (AIRCR.SYSRESETREQ), the USBREGSTATUS register may not correctly reflect VBUS presence until a delay of several milliseconds.',
				workaround: 'After soft reset, delay VBUS status reading by at least 5 ms. Alternatively, use the USBDETECTED/USBREMOVED events instead of polling USBREGSTATUS.',
				severity: 'minor',
				affectedRevisions: ['QIAA-B00'],
				documentPage: 72,
			},
		],
	},

	// ─── ESP32 ───────────────────────────────────────────────────────────────
	{
		family: 'ESP32',
		variants: ['ESP32', 'ESP32-D0WD', 'ESP32-D0WDR2', 'ESP32-S2', 'ESP32-S3', 'ESP32-C3', 'ESP32-C6', 'ESP32-H2'],
		errata: [
			{
				id: 'ESP32_ECO3_3.9',
				title: 'SPI flash: first read after deep sleep may return incorrect data',
				affectedPeripheral: 'SPI',
				description: 'After waking from deep sleep, the first SPI flash read via cache may return stale or incorrect data because the cache is not properly invalidated.',
				workaround: 'Call esp_spiram_init() or spi_flash_guard_set() with cache invalidation after wake-up. In ESP-IDF ≥ 4.4, this is handled automatically in the wake-up stub.',
				severity: 'major',
				affectedRevisions: ['0', '1'],
				fixedInRevision: '3 (ECO3)',
				documentPage: 18,
			},
			{
				id: 'ESP32_3.11',
				title: 'GPIO: strapping pin GPIOs cannot be used as outputs during boot',
				affectedPeripheral: 'GPIO',
				description: 'GPIO0, GPIO2, GPIO5, GPIO12, GPIO15 are strapping pins. During boot, their values are sampled to configure boot mode. External pull-ups/pull-downs on these pins can affect boot behavior.',
				workaround: 'Avoid using strapping pins for outputs that need to be driven during boot. If unavoidable, ensure external circuitry does not conflict with the required strapping values (GPIO0=HIGH for normal boot, GPIO2=LOW for normal boot).',
				severity: 'minor',
				affectedRevisions: ['0', '1', '3'],
				documentPage: 22,
			},
			{
				id: 'ESP32S3_3.4',
				title: 'USB-OTG: USB PHY may fail to enumerate on power-up',
				affectedPeripheral: 'USB',
				description: 'On ESP32-S3, the USB PHY may fail to enumerate on initial power-up if the USB cable was connected before power was applied.',
				workaround: 'Implement a USB PHY reset sequence in the initialization code: disable the USB PHY, wait 10 ms, re-enable. ESP-IDF tinyusb driver handles this automatically since v5.1.',
				severity: 'major',
				affectedRevisions: ['0'],
				fixedInRevision: '1',
				documentPage: 15,
			},
		],
	},

	// ─── RP2040 ──────────────────────────────────────────────────────────────
	{
		family: 'RP2040',
		variants: ['RP2040'],
		errata: [
			{
				id: 'RP2040_E5',
				title: 'GPIO: input synchroniser may not work after certain pad configurations',
				affectedPeripheral: 'GPIO',
				description: 'If a GPIO pad is configured with the input enable (IE) bit cleared and then later set, the input synchroniser may not function correctly, causing glitches or stuck values on GPIO reads.',
				workaround: 'Always keep IE set for GPIOs that will be used as inputs at any point. If you must toggle IE, perform a dummy read of the GPIO value after re-enabling to flush the synchroniser.',
				severity: 'minor',
				affectedRevisions: ['B0', 'B1'],
				fixedInRevision: 'B2',
				documentPage: 624,
			},
			{
				id: 'RP2040_E9',
				title: 'USB: device may fail to be recognised after being unplugged and re-plugged',
				affectedPeripheral: 'USB',
				description: 'After a USB disconnect/reconnect cycle, the device may not re-enumerate because the USB PHY retains stale state from the previous connection.',
				workaround: 'On disconnect detection (via SE0 or VBUS loss), perform a full USB peripheral reset: clear USBCTRL_REGS, reset the USB DPRAM, then reconfigure. The Pico SDK usb_device_reset() function implements this.',
				severity: 'major',
				affectedRevisions: ['B0', 'B1'],
				documentPage: 626,
			},
			{
				id: 'RP2040_E7',
				title: 'SSI: concurrent XIP and non-XIP flash accesses can deadlock',
				affectedPeripheral: 'SSI',
				description: 'If core 0 is executing code from XIP (flash) while core 1 attempts a direct SSI access to flash (e.g. for flash programming), the SSI bus arbiter can enter a deadlock state.',
				workaround: 'When programming flash, ensure the other core is either halted or executing entirely from SRAM. Use the multicore lockout mechanism (multicore_lockout_start_blocking()) before flash operations.',
				severity: 'critical',
				affectedRevisions: ['B0', 'B1', 'B2'],
				documentPage: 625,
			},
		],
	},

	// ─── STM32G4 ─────────────────────────────────────────────────────────────
	{
		family: 'STM32G4',
		variants: ['STM32G431', 'STM32G441', 'STM32G471', 'STM32G473', 'STM32G474', 'STM32G483', 'STM32G484', 'STM32G491'],
		errata: [
			{
				id: 'ES_STM32G4_2.2.1',
				title: 'ADC: wrong conversion data read when injected conversion interrupted by regular group',
				affectedPeripheral: 'ADC',
				description: 'When an injected conversion is interrupted by a higher-priority regular group conversion, the injected data register (ADC_JDRx) may contain the result of the regular conversion instead.',
				workaround: 'Avoid concurrent injected and regular group conversions on the same ADC instance. If both are needed, use separate ADC instances (ADC1 for regular, ADC2 for injected).',
				severity: 'major',
				affectedRevisions: ['A', 'Z'],
				documentPage: 12,
			},
			{
				id: 'ES_STM32G4_2.4.1',
				title: 'HRTIM: output stuck after fault exit in push-pull mode',
				affectedPeripheral: 'HRTIM',
				description: 'In push-pull output mode, if a fault condition occurs and clears, one of the complementary outputs may remain stuck in its fault state.',
				workaround: 'After fault exit, disable and re-enable the HRTIM output by toggling the corresponding OEN bit in HRTIM_OENR. Add a dead-time guard before re-enabling.',
				severity: 'critical',
				affectedRevisions: ['A'],
				fixedInRevision: 'Z',
				documentPage: 20,
			},
		],
	},

	// ─── STM32F1 ─────────────────────────────────────────────────────────────
	{
		family: 'STM32F1',
		variants: ['STM32F103', 'STM32F105', 'STM32F107', 'STM32F100', 'STM32F101', 'STM32F102'],
		errata: [
			{
				id: 'ES_STM32F1_2.9.1',
				title: 'USB: buffer descriptor table corruption in double-buffered mode',
				affectedPeripheral: 'USB',
				description: 'In double-buffered isochronous mode, the USB peripheral may corrupt the buffer descriptor table when both buffers complete at the same time as a SOF event.',
				workaround: 'Use single-buffered mode for isochronous endpoints, or implement a SOF interrupt handler that reads and validates the buffer descriptor table each frame.',
				severity: 'major',
				affectedRevisions: ['A', 'Z', 'Y'],
				documentPage: 44,
			},
		],
	},
];


/**
 * Lookup errata by MCU family prefix (e.g. "STM32F407" matches "STM32F4" family).
 */
export function lookupErrataForMCU(mcuVariant: string): IErrata[] {
	const upper = mcuVariant.toUpperCase();
	for (const family of BUILTIN_ERRATA) {
		if (family.variants.some(v => upper.startsWith(v.toUpperCase()))) {
			return family.errata;
		}
		if (upper.startsWith(family.family.toUpperCase())) {
			return family.errata;
		}
	}
	return [];
}

/**
 * Search all errata matching a peripheral + operation description.
 */
export function searchErrata(query: { peripheral?: string; operation?: string; mcuFamily?: string }): IErrata[] {
	let pool: IErrata[] = [];

	if (query.mcuFamily) {
		pool = lookupErrataForMCU(query.mcuFamily);
	} else {
		pool = BUILTIN_ERRATA.flatMap(f => f.errata);
	}

	if (query.peripheral) {
		const periph = query.peripheral.toUpperCase().replace(/[0-9]+$/, '');
		pool = pool.filter(e =>
			e.affectedPeripheral.toUpperCase().includes(periph) ||
			periph.includes(e.affectedPeripheral.toUpperCase())
		);
	}

	if (query.operation) {
		const op = query.operation.toLowerCase();
		pool = pool.filter(e =>
			e.description.toLowerCase().includes(op) ||
			e.title.toLowerCase().includes(op) ||
			(e.workaround?.toLowerCase().includes(op) ?? false)
		);
	}

	return pool;
}
