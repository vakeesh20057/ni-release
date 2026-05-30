/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IPeripheralCatalogService } from '../peripheralCatalog/peripheralCatalogService.js';
import { IPeripheralCatalogEntry } from '../peripheralCatalog/peripheralCatalogTypes.js';


export function buildPeripheralCatalogTools(
	session: IFirmwareSessionService,
	catalog: IPeripheralCatalogService,
): IVoidInternalTool[] {
	return [
		_fwPeripheralSearch(catalog),
		_fwPeripheralAdd(session, catalog),
		_fwPeripheralRemove(catalog),
		_fwPeripheralList(catalog),
		_fwPeripheralWiring(session, catalog),
		_fwPeripheralDriver(session, catalog),
	];
}


function _fwPeripheralSearch(catalog: IPeripheralCatalogService): IVoidInternalTool {
	return {
		name: 'fw_peripheral_search',
		description: `Search the Neural Inverse peripheral catalog (${catalog.getCatalogSize()}+ components). Search by part number, description, or category. Returns matching components with key specs and wiring hints.`,
		params: {
			query: { description: 'Search query: part number (BME280), category (imu, barometer, display, flash), or description keyword (temperature, stepper, LoRa).' },
		},
		execute: async (args: Record<string, unknown>) => {
			const query = String(args.query ?? '');
			const results = catalog.search(query);

			if (results.length === 0) {
				return [
					`No peripherals found for "${query}".`,
					``,
					`Try:`,
					`  - Part number: BME280, MPU6050, SSD1306, W25Q128`,
					`  - Category: imu, barometer, temperature, display, flash, adc, motor-driver, transceiver, rtc`,
					`  - Keyword: temperature, gyroscope, OLED, NOR flash, stepper, LoRa`,
					``,
					`Catalog size: ${catalog.getCatalogSize()} components`,
				].join('\n');
			}

			const lines = [
				`Found ${results.length} result(s) for "${query || '(all)'}":`,
				``,
			];

			for (const entry of results) {
				lines.push(_formatEntryShort(entry));
			}

			lines.push('');
			lines.push(`Add to session: fw_peripheral_add({ partNumber: "<PART_NUMBER>" })`);
			lines.push(`Get wiring:     fw_peripheral_wiring({ partNumber: "<PART_NUMBER>" })`);

			return lines.join('\n');
		},
	};
}


function _fwPeripheralAdd(session: IFirmwareSessionService, catalog: IPeripheralCatalogService): IVoidInternalTool {
	return {
		name: 'fw_peripheral_add',
		description: 'Attach a peripheral to the current firmware session. Once attached, the AI has full awareness of the peripheral\'s protocol, I2C address, initialization sequence, and register map hints for code generation.',
		params: {
			partNumber: { description: 'Part number from fw_peripheral_search, e.g. "BME280", "MPU-6050", "SSD1306".' },
		},
		execute: async (args: Record<string, unknown>) => {
			const partNumber = String(args.partNumber ?? '');
			if (!partNumber) { return 'Provide partNumber, e.g. "BME280".'; }

			catalog.attachToSession(partNumber);
			const entry = catalog.getEntry(partNumber);
			if (!entry) { return `Peripheral "${partNumber}" not found.`; }

			return [
				`Added ${entry.partNumber} to session.`,
				``,
				_formatEntryFull(entry),
				``,
				`The AI now has full context for ${entry.partNumber}:`,
				`  - Protocol: ${entry.interfaces.join('/')}`,
				entry.i2cAddress ? `  - I2C address: ${entry.i2cAddress.map(a => `0x${a.toString(16).toUpperCase()}`).join(' or ')}` : '',
				`  - ${entry.agentHints.length} initialization hints loaded`,
				``,
				`Generate driver: fw_peripheral_driver({ partNumber: "${entry.partNumber}" })`,
				`Show wiring:     fw_peripheral_wiring({ partNumber: "${entry.partNumber}" })`,
			].filter(Boolean).join('\n');
		},
	};
}


function _fwPeripheralRemove(catalog: IPeripheralCatalogService): IVoidInternalTool {
	return {
		name: 'fw_peripheral_remove',
		description: 'Detach a peripheral from the current firmware session to remove it from AI context.',
		params: {
			partNumber: { description: 'Part number to remove.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const partNumber = String(args.partNumber ?? '');
			if (!partNumber) { return 'Provide partNumber.'; }

			catalog.detachFromSession(partNumber);
			return `Removed ${partNumber} from session.`;
		},
	};
}


function _fwPeripheralList(catalog: IPeripheralCatalogService): IVoidInternalTool {
	return {
		name: 'fw_peripheral_list',
		description: 'List all peripherals currently attached to the firmware session.',
		params: {},
		execute: async () => {
			const peripherals = catalog.getSessionPeripherals();

			if (peripherals.length === 0) {
				return [
					'No peripherals attached to current session.',
					'',
					'Add peripherals with: fw_peripheral_add({ partNumber: "BME280" })',
					'Search catalog:       fw_peripheral_search({ query: "temperature" })',
				].join('\n');
			}

			const lines = [`Session peripherals (${peripherals.length}):`];
			for (const p of peripherals) {
				lines.push(`  ${p.partNumber.padEnd(16)} ${p.manufacturer} — ${p.description.substring(0, 50)}`);
				lines.push(`    Interface: ${p.interfaces.join('/')} | VDD: ${p.vddMin ?? '?'}-${p.vddMax ?? '?'}V`);
			}
			return lines.join('\n');
		},
	};
}


function _fwPeripheralWiring(session: IFirmwareSessionService, catalog: IPeripheralCatalogService): IVoidInternalTool {
	return {
		name: 'fw_peripheral_wiring',
		description: 'Show typical wiring for a peripheral with the active MCU. Returns pin connections, voltage level requirements, and required pull-up/bypass capacitors.',
		params: {
			partNumber: { description: 'Part number, e.g. "BME280", "MPU-6050".' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			const partNumber = String(args.partNumber ?? '');
			if (!partNumber) { return 'Provide partNumber.'; }

			const entry = catalog.getEntry(partNumber);
			if (!entry) { return `Peripheral "${partNumber}" not found. Use fw_peripheral_search.`; }

			const mcu = s.mcuConfig;
			const mcuLabel = mcu ? `${mcu.family} ${mcu.variant}` : 'MCU';
			const mcuVdd = 3.3;

			const lines = [
				`Wiring: ${entry.partNumber} with ${mcuLabel}`,
				`${'─'.repeat(60)}`,
			];

			if (entry.interfaces.includes('i2c')) {
				lines.push(`I2C Wiring:`);
				lines.push(`  MCU SDA  <-----> ${entry.partNumber} SDA`);
				lines.push(`  MCU SCL  <-----> ${entry.partNumber} SCL`);
				lines.push(`  4.7kΩ pull-up from SDA to VDD (required for I2C)`);
				lines.push(`  4.7kΩ pull-up from SCL to VDD (required for I2C)`);
				if (entry.i2cAddress && entry.i2cAddress.length > 1) {
					lines.push(`  Address select pin: ${entry.i2cAddress.map((a, i) => `0x${a.toString(16).toUpperCase()}=${i === 0 ? 'GND' : 'VDD'}`).join(', ')}`);
				}
				lines.push('');
			}

			if (entry.interfaces.includes('spi')) {
				lines.push(`SPI Wiring:`);
				lines.push(`  MCU SCK   <-----> ${entry.partNumber} SCK/CLK`);
				lines.push(`  MCU MOSI  <-----> ${entry.partNumber} SDI/DIN/MOSI`);
				lines.push(`  MCU MISO  <-----> ${entry.partNumber} SDO/DOUT/MISO`);
				lines.push(`  MCU GPIOx <-----> ${entry.partNumber} CSN/SS (chip select)`);
				if (entry.spiMode !== undefined) {
					lines.push(`  SPI Mode: ${entry.spiMode} (CPOL=${entry.spiMode >> 1}, CPHA=${entry.spiMode & 1})`);
				}
				if (entry.spiMaxMHz) {
					lines.push(`  Max SPI clock: ${entry.spiMaxMHz} MHz`);
				}
				lines.push('');
			}

			if (entry.interfaces.includes('uart')) {
				lines.push(`UART Wiring:`);
				lines.push(`  MCU TX  <-----> ${entry.partNumber} RX`);
				lines.push(`  MCU RX  <-----> ${entry.partNumber} TX`);
				if (entry.uart) {
					lines.push(`  Baud rate: ${entry.uart.baudRate} ${entry.uart.format}`);
				}
				lines.push('');
			}

			// Power wiring
			lines.push(`Power:`);
			const needsLevelShifter = (entry.vddMax ?? 3.6) < mcuVdd - 0.1;
			if (needsLevelShifter) {
				lines.push(`  [WARNING] ${entry.partNumber} max VDD: ${entry.vddMax}V — MCU is ${mcuVdd}V`);
				lines.push(`  Level shifter required on signal lines!`);
				lines.push(`  Use BSS138 or TXS0102 bidirectional level shifter.`);
			} else {
				lines.push(`  VDD  <-----> ${mcuVdd}V supply`);
			}
			lines.push(`  GND  <-----> MCU GND`);
			lines.push(`  Add 100nF bypass capacitor close to VDD pin`);
			lines.push('');

			// Key init hints
			if (entry.agentHints.length > 0) {
				lines.push(`Initialization summary:`);
				for (const hint of entry.agentHints.slice(0, 3)) {
					lines.push(`  ${hint}`);
				}
			}

			lines.push('');
			lines.push(`Generate driver code: fw_peripheral_driver({ partNumber: "${entry.partNumber}" })`);

			return lines.join('\n');
		},
	};
}


function _fwPeripheralDriver(session: IFirmwareSessionService, catalog: IPeripheralCatalogService): IVoidInternalTool {
	return {
		name: 'fw_peripheral_driver',
		description: 'Generate a driver skeleton for a peripheral based on its protocol, register map, and initialization sequence. The generated code includes correct I2C/SPI initialization, register writes with comments, and read functions.',
		params: {
			partNumber: { description: 'Part number, e.g. "BME280", "SSD1306".' },
			interface: { description: 'Which interface to use if multiple supported: "i2c", "spi". Auto-selects first available.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			const partNumber = String(args.partNumber ?? '');
			if (!partNumber) { return 'Provide partNumber.'; }

			const entry = catalog.getEntry(partNumber);
			if (!entry) { return `Peripheral "${partNumber}" not found.`; }

			const iface = String(args.interface ?? entry.interfaces[0] ?? 'i2c');
			const family = s.mcuConfig?.family ?? 'STM32F4';
			const varPrefix = entry.partNumber.toLowerCase().replace(/[-_.]/g, '_');

			const lines = [
				`/* ${entry.partNumber} driver skeleton */`,
				`/* ${entry.manufacturer} — ${entry.description} */`,
				`/* Interface: ${iface.toUpperCase()} */`,
				``,
				`#include <stdint.h>`,
				`#include <stdbool.h>`,
				``,
			];

			if (iface === 'i2c') {
				const addr = entry.i2cAddress?.[0] ?? 0x00;
				const addrShifted = addr << 1;
				lines.push(`#define ${entry.partNumber.replace(/-/g, '_').toUpperCase()}_I2C_ADDR  (0x${addrShifted.toString(16).toUpperCase()}U) /* 7-bit 0x${addr.toString(16).toUpperCase()}, shifted for HAL */`);
				lines.push('');

				// Extract register defines from agent hints (multiple formats)
				const regLines: string[] = [];
				for (const hint of entry.agentHints) {
					// Match patterns: "REG_NAME (0xNN)" or "REG_NAME register 0xNN" or "write 0xNN to REG_NAME (0xNN)"
					const patterns = [
						/([A-Z][A-Z0-9_]+)\s+\(0x([0-9A-Fa-f]+)\)/g,
						/register\s+0x([0-9A-Fa-f]+)\s+\(([A-Z][A-Z0-9_]+)\)/g,
					];
					for (const pattern of patterns) {
						let m: RegExpExecArray | null;
						while ((m = pattern.exec(hint)) !== null) {
							const regName = m[1] ?? m[2] ?? '';
							const regAddr = m[2] ?? m[1] ?? '';
							if (regName && regAddr && regName.length > 2 && !regLines.includes(regName)) {
								regLines.push(regName);
								lines.push(`#define ${entry.partNumber.replace(/-/g, '_').toUpperCase()}_REG_${regName.padEnd(20)} 0x${regAddr.toUpperCase()}U`);
							}
						}
					}
				}
				lines.push('');

				// I2C helper stubs using HAL
				lines.push(`static HAL_StatusTypeDef ${varPrefix}_write_reg(uint8_t reg, uint8_t val)`);
				lines.push(`{`);
				lines.push(`    uint8_t buf[2] = { reg, val };`);
				lines.push(`    return HAL_I2C_Master_Transmit(&hi2c1, ${entry.partNumber.replace(/-/g, '_').toUpperCase()}_I2C_ADDR, buf, 2, HAL_MAX_DELAY);`);
				lines.push(`}`);
				lines.push('');
				lines.push(`static HAL_StatusTypeDef ${varPrefix}_read_reg(uint8_t reg, uint8_t *data, uint16_t len)`);
				lines.push(`{`);
				lines.push(`    HAL_StatusTypeDef ret;`);
				lines.push(`    ret = HAL_I2C_Master_Transmit(&hi2c1, ${entry.partNumber.replace(/-/g, '_').toUpperCase()}_I2C_ADDR, &reg, 1, HAL_MAX_DELAY);`);
				lines.push(`    if (ret != HAL_OK) return ret;`);
				lines.push(`    return HAL_I2C_Master_Receive(&hi2c1, ${entry.partNumber.replace(/-/g, '_').toUpperCase()}_I2C_ADDR | 1, data, len, HAL_MAX_DELAY);`);
				lines.push(`}`);
				lines.push('');

				// Generate init from hints — extract actual register values mentioned
				lines.push(`/* Initialize ${entry.partNumber} */`);
				lines.push(`/* Source: ${entry.manufacturer} ${entry.partNumber} datasheet */`);
				lines.push(`HAL_StatusTypeDef ${varPrefix}_init(void)`);
				lines.push(`{`);
				lines.push(`    HAL_StatusTypeDef ret;`);
				lines.push(`    uint8_t chip_id;`);
				lines.push('');

				// Parse init steps from hints
				for (const hint of entry.agentHints) {
					// Look for "write 0xVAL to reg (0xADDR)" or "REG (0xADDR) = 0xVAL"
					const writeMatch = hint.match(/write\s+0x([0-9A-Fa-f]+)\s+to\s+(\w+)\s+\(0x([0-9A-Fa-f]+)\)/i);
					const equalsMatch = hint.match(/([A-Z][A-Z0-9_]+)\s+\(0x([0-9A-Fa-f]+)\)\s*=\s*0x([0-9A-Fa-f]+)/);
					const whoMatch = hint.match(/WHO_AM_I.*\(0x([0-9A-Fa-f]+)\).*=.*0x([0-9A-Fa-f]+)/i);
					const chipIdMatch = hint.match(/chip_id.*register.*0x([0-9A-Fa-f]+).*=.*0x([0-9A-Fa-f]+)/i);

					if (whoMatch || chipIdMatch) {
						const m = whoMatch ?? chipIdMatch!;
						lines.push(`    /* Verify device ID */`);
						lines.push(`    ret = ${varPrefix}_read_reg(0x${m[1]?.toUpperCase()}, &chip_id, 1);`);
						lines.push(`    if (ret != HAL_OK) return ret;`);
						lines.push(`    if (chip_id != 0x${m[2]?.toUpperCase()}) return HAL_ERROR; /* Wrong device */`);
						lines.push('');
					} else if (writeMatch) {
						lines.push(`    /* ${hint.substring(0, 60)} */`);
						lines.push(`    ret = ${varPrefix}_write_reg(0x${writeMatch[3]?.toUpperCase()}, 0x${writeMatch[1]?.toUpperCase()});`);
						lines.push(`    if (ret != HAL_OK) return ret;`);
					} else if (equalsMatch) {
						lines.push(`    /* ${hint.substring(0, 60)} */`);
						lines.push(`    ret = ${varPrefix}_write_reg(0x${equalsMatch[2]?.toUpperCase()}, 0x${equalsMatch[3]?.toUpperCase()});`);
						lines.push(`    if (ret != HAL_OK) return ret;`);
					}
				}

				lines.push(`    HAL_Delay(5); /* power-on stabilization */`);
				lines.push(`    return HAL_OK;`);
				lines.push(`}`);
				lines.push('');

				lines.push(`/* Read ${entry.partNumber} measurement — customize for your application */`);
				lines.push(`HAL_StatusTypeDef ${varPrefix}_read(float *value)`);
				lines.push(`{`);
				lines.push(`    uint8_t buf[8];`);
				lines.push(`    HAL_StatusTypeDef ret;`);
				lines.push('');
				lines.push(`    /* Read measurement registers — see ${entry.partNumber} datasheet for exact offsets */`);
				const readHint = entry.agentHints.find(h => h.toLowerCase().includes('read') && h.match(/0x[0-9A-Fa-f]+/));
				if (readHint) {
					const addrMatch = readHint.match(/0x([0-9A-Fa-f]+)/);
					const lenMatch = readHint.match(/(\d+)\s+bytes?/);
					const regAddr = addrMatch?.[1]?.toUpperCase() ?? '00';
					const len = lenMatch ? parseInt(lenMatch[1]!) : 2;
					lines.push(`    /* ${readHint.substring(0, 70)} */`);
					lines.push(`    ret = ${varPrefix}_read_reg(0x${regAddr}, buf, ${len});`);
					lines.push(`    if (ret != HAL_OK) return ret;`);
					lines.push(`    *value = (int16_t)((buf[0] << 8) | buf[1]); /* raw — apply scaling */`);
				} else {
					lines.push(`    ret = ${varPrefix}_read_reg(0x00, buf, 2);`);
					lines.push(`    if (ret != HAL_OK) return ret;`);
					lines.push(`    *value = (float)((int16_t)((buf[0] << 8) | buf[1]));`);
				}
				lines.push(`    return HAL_OK;`);
				lines.push(`}`);

			} else if (iface === 'spi') {
				lines.push(`/* SPI write register (CS pin must be managed by caller) */`);
				lines.push(`static void ${varPrefix}_write_reg(SPI_HandleTypeDef *hspi, GPIO_TypeDef *cs_port, uint16_t cs_pin, uint8_t reg, uint8_t val)`);
				lines.push(`{`);
				lines.push(`    uint8_t buf[2] = { reg & 0x7FU, val }; /* bit 7 = 0 for write */`);
				lines.push(`    HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_RESET);`);
				lines.push(`    HAL_SPI_Transmit(hspi, buf, 2, HAL_MAX_DELAY);`);
				lines.push(`    HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_SET);`);
				lines.push(`}`);
				lines.push('');
				lines.push(`static uint8_t ${varPrefix}_read_reg(SPI_HandleTypeDef *hspi, GPIO_TypeDef *cs_port, uint16_t cs_pin, uint8_t reg)`);
				lines.push(`{`);
				lines.push(`    uint8_t tx = reg | 0x80U; /* bit 7 = 1 for read (most SPI sensors) */`);
				lines.push(`    uint8_t rx = 0;`);
				lines.push(`    HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_RESET);`);
				lines.push(`    HAL_SPI_TransmitReceive(hspi, &tx, &rx, 1, HAL_MAX_DELAY);`);
				lines.push(`    HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_SET);`);
				lines.push(`    return rx;`);
				lines.push(`}`);
				lines.push('');
				lines.push(`/* Initialize ${entry.partNumber} */`);
				lines.push(`/* SPI Mode: ${entry.spiMode ?? 0}, Max clock: ${entry.spiMaxMHz ?? '?'} MHz */`);
				lines.push(`void ${varPrefix}_init(SPI_HandleTypeDef *hspi, GPIO_TypeDef *cs_port, uint16_t cs_pin)`);
				lines.push(`{`);
				// Extract init writes from hints
				for (const hint of entry.agentHints) {
					const m = hint.match(/([A-Z][A-Z0-9_]+)\s+\(0x([0-9A-Fa-f]+)\)\s*=\s*0x([0-9A-Fa-f]+)/);
					if (m) {
						lines.push(`    /* ${hint.substring(0, 60)} */`);
						lines.push(`    ${varPrefix}_write_reg(hspi, cs_port, cs_pin, 0x${m[2]?.toUpperCase()}, 0x${m[3]?.toUpperCase()});`);
					}
				}
				lines.push(`}`);
			}

			lines.push('');
			lines.push(`/* For a complete driver with full compensation formulas and error handling, ask: */`);
			lines.push(`/* "Write a production-ready ${entry.partNumber} driver for ${family} using HAL" */`);

			return lines.join('\n');
		},
	};
}


// ─── Formatting helpers ───────────────────────────────────────────────────────

function _formatEntryShort(e: IPeripheralCatalogEntry): string {
	const addr = e.i2cAddress ? ` | I2C: ${e.i2cAddress.map(a => `0x${a.toString(16).toUpperCase()}`).join('/')}` : '';
	return `  ${e.partNumber.padEnd(16)} ${e.manufacturer} — ${e.description.substring(0, 45)}${e.description.length > 45 ? '...' : ''}` +
		`\n    ${e.interfaces.join('/')} | ${e.vddMin ?? '?'}-${e.vddMax ?? '?'}V${addr}`;
}

function _formatEntryFull(e: IPeripheralCatalogEntry): string {
	const lines = [
		`${e.partNumber} — ${e.description}`,
		`Manufacturer: ${e.manufacturer}`,
		`Category: ${e.category}`,
		`Interfaces: ${e.interfaces.join(', ')}`,
		`Supply: ${e.vddMin ?? '?'}-${e.vddMax ?? '?'}V`,
	];
	if (e.i2cAddress) { lines.push(`I2C address: ${e.i2cAddress.map(a => `0x${a.toString(16).toUpperCase()}`).join(', ')}`); }
	if (e.spiMode !== undefined) { lines.push(`SPI mode: ${e.spiMode} | Max: ${e.spiMaxMHz ?? '?'} MHz`); }
	if (e.datasheetUrl) { lines.push(`Datasheet: ${e.datasheetUrl}`); }
	return lines.join('\n');
}
