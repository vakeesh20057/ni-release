/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * STM32 GPIO Alternate Function (AF) Pin Mapping Database
 *
 * Encodes the GPIO alternate function table from STM32 reference manuals.
 * This is the source of truth for which AF number routes a specific peripheral
 * signal to a given pin — data that SVD files omit or encode inconsistently.
 *
 * Sources: STM32F4 RM0090, STM32F0 RM0091, STM32F7 RM0410, STM32H7 RM0433,
 *          STM32G4 RM0440, STM32F1 RM0008 (AFIO), libopencm3 gpio tables.
 *
 * Format: { port, pin, af, signal }
 *   - port:   GPIO port letter ('A'..'K')
 *   - pin:    0..15
 *   - af:     0..15 (alternate function index)
 *   - signal: peripheral signal name, e.g. "USART1_TX"
 */

export interface IAFEntry {
	port: string;
	pin: number;
	af: number;
	signal: string;
}

/** Lookup AF entries for a given STM32 family prefix. */
export function getAFDatabaseForFamily(family: string): IAFEntry[] {
	const fam = family.toUpperCase();
	if (fam.startsWith('STM32F4')) { return STM32F4_AF; }
	if (fam.startsWith('STM32F7')) { return STM32F7_AF; }
	if (fam.startsWith('STM32H7')) { return STM32H7_AF; }
	if (fam.startsWith('STM32G4')) { return STM32G4_AF; }
	if (fam.startsWith('STM32F0')) { return STM32F0_AF; }
	if (fam.startsWith('STM32F1') || fam.startsWith('STM32F2') || fam.startsWith('STM32F3')) { return STM32F1_AF; }
	if (fam.startsWith('STM32L4') || fam.startsWith('STM32L5') || fam.startsWith('STM32WB') || fam.startsWith('STM32WL')) { return STM32L4_AF; }
	return [];
}


// ─── STM32F4 AF Table (RM0090) ────────────────────────────────────────────────
// Covers F405/F407/F415/F417/F427/F429/F439/F446/F469/F479.
// LQFP100/LQFP144 pins; entries ordered by port then pin.

const STM32F4_AF: IAFEntry[] = [
	// PA — USART2 TX/RX, SPI1, I2C3, TIM1/2/5, OTG, SAI, SDIO
	{ port: 'A', pin: 0,  af: 1,  signal: 'TIM2_CH1' },
	{ port: 'A', pin: 0,  af: 2,  signal: 'TIM5_CH1' },
	{ port: 'A', pin: 0,  af: 8,  signal: 'USART2_CTS' },
	{ port: 'A', pin: 1,  af: 1,  signal: 'TIM2_CH2' },
	{ port: 'A', pin: 1,  af: 2,  signal: 'TIM5_CH2' },
	{ port: 'A', pin: 1,  af: 7,  signal: 'USART2_RTS' },
	{ port: 'A', pin: 2,  af: 1,  signal: 'TIM2_CH3' },
	{ port: 'A', pin: 2,  af: 2,  signal: 'TIM5_CH3' },
	{ port: 'A', pin: 2,  af: 3,  signal: 'TIM9_CH1' },
	{ port: 'A', pin: 2,  af: 7,  signal: 'USART2_TX' },
	{ port: 'A', pin: 3,  af: 1,  signal: 'TIM2_CH4' },
	{ port: 'A', pin: 3,  af: 2,  signal: 'TIM5_CH4' },
	{ port: 'A', pin: 3,  af: 3,  signal: 'TIM9_CH2' },
	{ port: 'A', pin: 3,  af: 7,  signal: 'USART2_RX' },
	{ port: 'A', pin: 4,  af: 5,  signal: 'SPI1_NSS' },
	{ port: 'A', pin: 4,  af: 6,  signal: 'SPI3_NSS' },
	{ port: 'A', pin: 5,  af: 1,  signal: 'TIM2_CH1' },
	{ port: 'A', pin: 5,  af: 5,  signal: 'SPI1_SCK' },
	{ port: 'A', pin: 6,  af: 2,  signal: 'TIM3_CH1' },
	{ port: 'A', pin: 6,  af: 5,  signal: 'SPI1_MISO' },
	{ port: 'A', pin: 7,  af: 1,  signal: 'TIM1_CH1N' },
	{ port: 'A', pin: 7,  af: 2,  signal: 'TIM3_CH2' },
	{ port: 'A', pin: 7,  af: 5,  signal: 'SPI1_MOSI' },
	{ port: 'A', pin: 8,  af: 0,  signal: 'MCO1' },
	{ port: 'A', pin: 8,  af: 1,  signal: 'TIM1_CH1' },
	{ port: 'A', pin: 8,  af: 4,  signal: 'I2C3_SCL' },
	{ port: 'A', pin: 9,  af: 1,  signal: 'TIM1_CH2' },
	{ port: 'A', pin: 9,  af: 4,  signal: 'I2C3_SMBA' },
	{ port: 'A', pin: 9,  af: 7,  signal: 'USART1_TX' },
	{ port: 'A', pin: 10, af: 1,  signal: 'TIM1_CH3' },
	{ port: 'A', pin: 10, af: 7,  signal: 'USART1_RX' },
	{ port: 'A', pin: 11, af: 1,  signal: 'TIM1_CH4' },
	{ port: 'A', pin: 11, af: 7,  signal: 'USART1_CTS' },
	{ port: 'A', pin: 11, af: 10, signal: 'OTG_FS_DM' },
	{ port: 'A', pin: 12, af: 1,  signal: 'TIM1_ETR' },
	{ port: 'A', pin: 12, af: 7,  signal: 'USART1_RTS' },
	{ port: 'A', pin: 12, af: 10, signal: 'OTG_FS_DP' },
	{ port: 'A', pin: 13, af: 0,  signal: 'JTMS_SWDIO' },
	{ port: 'A', pin: 14, af: 0,  signal: 'JTCK_SWCLK' },
	{ port: 'A', pin: 15, af: 0,  signal: 'JTDI' },
	{ port: 'A', pin: 15, af: 1,  signal: 'TIM2_CH1' },
	{ port: 'A', pin: 15, af: 5,  signal: 'SPI1_NSS' },
	{ port: 'A', pin: 15, af: 6,  signal: 'SPI3_NSS' },
	// PB — USART3, SPI2, I2C1/2, TIM2-4, OTG_HS
	{ port: 'B', pin: 0,  af: 1,  signal: 'TIM1_CH2N' },
	{ port: 'B', pin: 0,  af: 2,  signal: 'TIM3_CH3' },
	{ port: 'B', pin: 1,  af: 1,  signal: 'TIM1_CH3N' },
	{ port: 'B', pin: 1,  af: 2,  signal: 'TIM3_CH4' },
	{ port: 'B', pin: 3,  af: 0,  signal: 'JTDO_SWO' },
	{ port: 'B', pin: 3,  af: 1,  signal: 'TIM2_CH2' },
	{ port: 'B', pin: 3,  af: 5,  signal: 'SPI1_SCK' },
	{ port: 'B', pin: 3,  af: 6,  signal: 'SPI3_SCK' },
	{ port: 'B', pin: 4,  af: 0,  signal: 'NJTRST' },
	{ port: 'B', pin: 4,  af: 2,  signal: 'TIM3_CH1' },
	{ port: 'B', pin: 4,  af: 5,  signal: 'SPI1_MISO' },
	{ port: 'B', pin: 4,  af: 6,  signal: 'SPI3_MISO' },
	{ port: 'B', pin: 5,  af: 2,  signal: 'TIM3_CH2' },
	{ port: 'B', pin: 5,  af: 5,  signal: 'SPI1_MOSI' },
	{ port: 'B', pin: 5,  af: 6,  signal: 'SPI3_MOSI' },
	{ port: 'B', pin: 5,  af: 11, signal: 'ETH_PPS_OUT' },
	{ port: 'B', pin: 6,  af: 2,  signal: 'TIM4_CH1' },
	{ port: 'B', pin: 6,  af: 4,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 6,  af: 7,  signal: 'USART1_TX' },
	{ port: 'B', pin: 7,  af: 2,  signal: 'TIM4_CH2' },
	{ port: 'B', pin: 7,  af: 4,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 7,  af: 7,  signal: 'USART1_RX' },
	{ port: 'B', pin: 8,  af: 2,  signal: 'TIM4_CH3' },
	{ port: 'B', pin: 8,  af: 3,  signal: 'TIM10_CH1' },
	{ port: 'B', pin: 8,  af: 4,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 8,  af: 9,  signal: 'CAN1_RX' },
	{ port: 'B', pin: 9,  af: 2,  signal: 'TIM4_CH4' },
	{ port: 'B', pin: 9,  af: 3,  signal: 'TIM11_CH1' },
	{ port: 'B', pin: 9,  af: 4,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 9,  af: 5,  signal: 'SPI2_NSS' },
	{ port: 'B', pin: 9,  af: 9,  signal: 'CAN1_TX' },
	{ port: 'B', pin: 10, af: 1,  signal: 'TIM2_CH3' },
	{ port: 'B', pin: 10, af: 4,  signal: 'I2C2_SCL' },
	{ port: 'B', pin: 10, af: 5,  signal: 'SPI2_SCK' },
	{ port: 'B', pin: 10, af: 7,  signal: 'USART3_TX' },
	{ port: 'B', pin: 11, af: 1,  signal: 'TIM2_CH4' },
	{ port: 'B', pin: 11, af: 4,  signal: 'I2C2_SDA' },
	{ port: 'B', pin: 11, af: 7,  signal: 'USART3_RX' },
	{ port: 'B', pin: 12, af: 1,  signal: 'TIM1_BKIN' },
	{ port: 'B', pin: 12, af: 4,  signal: 'I2C2_SMBA' },
	{ port: 'B', pin: 12, af: 5,  signal: 'SPI2_NSS' },
	{ port: 'B', pin: 12, af: 7,  signal: 'USART3_CK' },
	{ port: 'B', pin: 13, af: 1,  signal: 'TIM1_CH1N' },
	{ port: 'B', pin: 13, af: 5,  signal: 'SPI2_SCK' },
	{ port: 'B', pin: 13, af: 7,  signal: 'USART3_CTS' },
	{ port: 'B', pin: 14, af: 1,  signal: 'TIM1_CH2N' },
	{ port: 'B', pin: 14, af: 5,  signal: 'SPI2_MISO' },
	{ port: 'B', pin: 14, af: 7,  signal: 'USART3_RTS' },
	{ port: 'B', pin: 15, af: 1,  signal: 'TIM1_CH3N' },
	{ port: 'B', pin: 15, af: 5,  signal: 'SPI2_MOSI' },
	// PC — USART6, I2C3, SPI3, SDIO, TIM3/8
	{ port: 'C', pin: 0,  af: 12, signal: 'OTG_HS_ULPI_STP' },
	{ port: 'C', pin: 1,  af: 11, signal: 'ETH_MDC' },
	{ port: 'C', pin: 2,  af: 5,  signal: 'SPI2_MISO' },
	{ port: 'C', pin: 3,  af: 5,  signal: 'SPI2_MOSI' },
	{ port: 'C', pin: 4,  af: 11, signal: 'ETH_RXD0' },
	{ port: 'C', pin: 5,  af: 11, signal: 'ETH_RXD1' },
	{ port: 'C', pin: 6,  af: 2,  signal: 'TIM3_CH1' },
	{ port: 'C', pin: 6,  af: 3,  signal: 'TIM8_CH1' },
	{ port: 'C', pin: 6,  af: 8,  signal: 'USART6_TX' },
	{ port: 'C', pin: 7,  af: 2,  signal: 'TIM3_CH2' },
	{ port: 'C', pin: 7,  af: 3,  signal: 'TIM8_CH2' },
	{ port: 'C', pin: 7,  af: 8,  signal: 'USART6_RX' },
	{ port: 'C', pin: 8,  af: 2,  signal: 'TIM3_CH3' },
	{ port: 'C', pin: 8,  af: 3,  signal: 'TIM8_CH3' },
	{ port: 'C', pin: 8,  af: 12, signal: 'SDIO_D0' },
	{ port: 'C', pin: 9,  af: 2,  signal: 'TIM3_CH4' },
	{ port: 'C', pin: 9,  af: 3,  signal: 'TIM8_CH4' },
	{ port: 'C', pin: 9,  af: 4,  signal: 'I2C3_SDA' },
	{ port: 'C', pin: 9,  af: 12, signal: 'SDIO_D1' },
	{ port: 'C', pin: 10, af: 6,  signal: 'SPI3_SCK' },
	{ port: 'C', pin: 10, af: 7,  signal: 'USART3_TX' },
	{ port: 'C', pin: 10, af: 12, signal: 'SDIO_D2' },
	{ port: 'C', pin: 11, af: 5,  signal: 'SPI3_MISO' },
	{ port: 'C', pin: 11, af: 7,  signal: 'USART3_RX' },
	{ port: 'C', pin: 11, af: 12, signal: 'SDIO_D3' },
	{ port: 'C', pin: 12, af: 6,  signal: 'SPI3_MOSI' },
	{ port: 'C', pin: 12, af: 7,  signal: 'USART3_CK' },
	{ port: 'C', pin: 12, af: 12, signal: 'SDIO_CK' },
	// PD — USART2/3, SDIO, CAN, FMC
	{ port: 'D', pin: 0,  af: 9,  signal: 'CAN1_RX' },
	{ port: 'D', pin: 1,  af: 9,  signal: 'CAN1_TX' },
	{ port: 'D', pin: 2,  af: 12, signal: 'SDIO_CMD' },
	{ port: 'D', pin: 3,  af: 5,  signal: 'SPI2_SCK' },
	{ port: 'D', pin: 3,  af: 7,  signal: 'USART2_CTS' },
	{ port: 'D', pin: 4,  af: 7,  signal: 'USART2_RTS' },
	{ port: 'D', pin: 5,  af: 7,  signal: 'USART2_TX' },
	{ port: 'D', pin: 6,  af: 5,  signal: 'SPI3_MOSI' },
	{ port: 'D', pin: 6,  af: 7,  signal: 'USART2_RX' },
	{ port: 'D', pin: 7,  af: 7,  signal: 'USART2_CK' },
	{ port: 'D', pin: 8,  af: 7,  signal: 'USART3_TX' },
	{ port: 'D', pin: 9,  af: 7,  signal: 'USART3_RX' },
	{ port: 'D', pin: 10, af: 7,  signal: 'USART3_CK' },
	{ port: 'D', pin: 11, af: 7,  signal: 'USART3_CTS' },
	{ port: 'D', pin: 12, af: 2,  signal: 'TIM4_CH1' },
	{ port: 'D', pin: 12, af: 7,  signal: 'USART3_RTS' },
	{ port: 'D', pin: 13, af: 2,  signal: 'TIM4_CH2' },
	{ port: 'D', pin: 14, af: 2,  signal: 'TIM4_CH3' },
	{ port: 'D', pin: 15, af: 2,  signal: 'TIM4_CH4' },
	// PE — TIM1/9, USART, SPI, FMC
	{ port: 'E', pin: 0,  af: 2,  signal: 'TIM4_ETR' },
	{ port: 'E', pin: 5,  af: 3,  signal: 'TIM9_CH1' },
	{ port: 'E', pin: 6,  af: 3,  signal: 'TIM9_CH2' },
	{ port: 'E', pin: 7,  af: 1,  signal: 'TIM1_ETR' },
	{ port: 'E', pin: 8,  af: 1,  signal: 'TIM1_CH1N' },
	{ port: 'E', pin: 9,  af: 1,  signal: 'TIM1_CH1' },
	{ port: 'E', pin: 10, af: 1,  signal: 'TIM1_CH2N' },
	{ port: 'E', pin: 11, af: 1,  signal: 'TIM1_CH2' },
	{ port: 'E', pin: 11, af: 5,  signal: 'SPI4_NSS' },
	{ port: 'E', pin: 12, af: 1,  signal: 'TIM1_CH3N' },
	{ port: 'E', pin: 12, af: 5,  signal: 'SPI4_SCK' },
	{ port: 'E', pin: 13, af: 1,  signal: 'TIM1_CH3' },
	{ port: 'E', pin: 13, af: 5,  signal: 'SPI4_MISO' },
	{ port: 'E', pin: 14, af: 1,  signal: 'TIM1_CH4' },
	{ port: 'E', pin: 14, af: 5,  signal: 'SPI4_MOSI' },
	{ port: 'E', pin: 15, af: 1,  signal: 'TIM1_BKIN' },
	// PF — I2C2, SPI5, TIM
	{ port: 'F', pin: 6,  af: 3,  signal: 'TIM10_CH1' },
	{ port: 'F', pin: 7,  af: 3,  signal: 'TIM11_CH1' },
	{ port: 'F', pin: 7,  af: 5,  signal: 'SPI5_SCK' },
	{ port: 'F', pin: 8,  af: 5,  signal: 'SPI5_MISO' },
	{ port: 'F', pin: 9,  af: 5,  signal: 'SPI5_MOSI' },
	// PG — USART6, SPI1, ETH
	{ port: 'G', pin: 9,  af: 8,  signal: 'USART6_RX' },
	{ port: 'G', pin: 11, af: 11, signal: 'ETH_TX_EN' },
	{ port: 'G', pin: 13, af: 11, signal: 'ETH_TXD0' },
	{ port: 'G', pin: 14, af: 8,  signal: 'USART6_TX' },
	{ port: 'G', pin: 14, af: 11, signal: 'ETH_TXD1' },
	// PH — I2C
	{ port: 'H', pin: 4,  af: 4,  signal: 'I2C2_SCL' },
	{ port: 'H', pin: 5,  af: 4,  signal: 'I2C2_SDA' },
	{ port: 'H', pin: 7,  af: 4,  signal: 'I2C3_SCL' },
	{ port: 'H', pin: 8,  af: 4,  signal: 'I2C3_SDA' },
];


// ─── STM32F0 AF Table (RM0091) ────────────────────────────────────────────────
// STM32F0 uses AFIO differently — AF0/AF1 cover most signals. No AF numbers > 7.

const STM32F0_AF: IAFEntry[] = [
	{ port: 'A', pin: 0,  af: 1,  signal: 'USART2_CTS' },
	{ port: 'A', pin: 0,  af: 2,  signal: 'TIM2_CH1' },
	{ port: 'A', pin: 1,  af: 1,  signal: 'USART2_RTS' },
	{ port: 'A', pin: 1,  af: 2,  signal: 'TIM2_CH2' },
	{ port: 'A', pin: 2,  af: 1,  signal: 'USART2_TX' },
	{ port: 'A', pin: 2,  af: 2,  signal: 'TIM2_CH3' },
	{ port: 'A', pin: 3,  af: 1,  signal: 'USART2_RX' },
	{ port: 'A', pin: 3,  af: 2,  signal: 'TIM2_CH4' },
	{ port: 'A', pin: 4,  af: 0,  signal: 'SPI1_NSS' },
	{ port: 'A', pin: 4,  af: 1,  signal: 'USART2_CK' },
	{ port: 'A', pin: 5,  af: 0,  signal: 'SPI1_SCK' },
	{ port: 'A', pin: 5,  af: 2,  signal: 'TIM2_CH1' },
	{ port: 'A', pin: 6,  af: 0,  signal: 'SPI1_MISO' },
	{ port: 'A', pin: 6,  af: 2,  signal: 'TIM3_CH1' },
	{ port: 'A', pin: 7,  af: 0,  signal: 'SPI1_MOSI' },
	{ port: 'A', pin: 7,  af: 2,  signal: 'TIM3_CH2' },
	{ port: 'A', pin: 9,  af: 1,  signal: 'USART1_TX' },
	{ port: 'A', pin: 10, af: 1,  signal: 'USART1_RX' },
	{ port: 'A', pin: 11, af: 1,  signal: 'USART1_CTS' },
	{ port: 'A', pin: 12, af: 1,  signal: 'USART1_RTS' },
	{ port: 'A', pin: 13, af: 0,  signal: 'SWDIO' },
	{ port: 'A', pin: 14, af: 0,  signal: 'SWCLK' },
	{ port: 'A', pin: 14, af: 1,  signal: 'USART2_TX' },
	{ port: 'A', pin: 15, af: 1,  signal: 'USART2_RX' },
	{ port: 'B', pin: 0,  af: 1,  signal: 'TIM3_CH3' },
	{ port: 'B', pin: 1,  af: 1,  signal: 'TIM3_CH4' },
	{ port: 'B', pin: 3,  af: 0,  signal: 'SPI1_SCK' },
	{ port: 'B', pin: 4,  af: 0,  signal: 'SPI1_MISO' },
	{ port: 'B', pin: 4,  af: 1,  signal: 'TIM3_CH1' },
	{ port: 'B', pin: 5,  af: 0,  signal: 'SPI1_MOSI' },
	{ port: 'B', pin: 5,  af: 1,  signal: 'TIM3_CH2' },
	{ port: 'B', pin: 6,  af: 0,  signal: 'USART1_TX' },
	{ port: 'B', pin: 6,  af: 1,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 7,  af: 0,  signal: 'USART1_RX' },
	{ port: 'B', pin: 7,  af: 1,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 8,  af: 1,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 9,  af: 1,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 10, af: 1,  signal: 'I2C2_SCL' },
	{ port: 'B', pin: 10, af: 2,  signal: 'USART3_TX' },
	{ port: 'B', pin: 11, af: 1,  signal: 'I2C2_SDA' },
	{ port: 'B', pin: 11, af: 2,  signal: 'USART3_RX' },
	{ port: 'B', pin: 13, af: 0,  signal: 'SPI2_SCK' },
	{ port: 'B', pin: 14, af: 0,  signal: 'SPI2_MISO' },
	{ port: 'B', pin: 15, af: 0,  signal: 'SPI2_MOSI' },
	{ port: 'C', pin: 4,  af: 1,  signal: 'USART3_TX' },
	{ port: 'C', pin: 5,  af: 1,  signal: 'USART3_RX' },
	{ port: 'C', pin: 6,  af: 0,  signal: 'TIM3_CH1' },
	{ port: 'C', pin: 7,  af: 0,  signal: 'TIM3_CH2' },
	{ port: 'C', pin: 8,  af: 0,  signal: 'TIM3_CH3' },
	{ port: 'C', pin: 9,  af: 0,  signal: 'TIM3_CH4' },
	{ port: 'C', pin: 10, af: 1,  signal: 'USART3_TX' },
	{ port: 'C', pin: 11, af: 1,  signal: 'USART3_RX' },
	{ port: 'C', pin: 12, af: 1,  signal: 'USART3_CK' },
	{ port: 'D', pin: 8,  af: 0,  signal: 'USART3_TX' },
	{ port: 'D', pin: 9,  af: 0,  signal: 'USART3_RX' },
];


// ─── STM32F7 AF Table (RM0410) ────────────────────────────────────────────────
// STM32F7x5/F7x6/F7x7 — largely compatible with F4 but adds UART7/8, SAI, LTDC.

const STM32F7_AF: IAFEntry[] = [
	{ port: 'A', pin: 0,  af: 1,  signal: 'TIM2_CH1' },
	{ port: 'A', pin: 0,  af: 2,  signal: 'TIM5_CH1' },
	{ port: 'A', pin: 0,  af: 8,  signal: 'UART4_TX' },
	{ port: 'A', pin: 1,  af: 1,  signal: 'TIM2_CH2' },
	{ port: 'A', pin: 1,  af: 2,  signal: 'TIM5_CH2' },
	{ port: 'A', pin: 1,  af: 8,  signal: 'UART4_RX' },
	{ port: 'A', pin: 2,  af: 1,  signal: 'TIM2_CH3' },
	{ port: 'A', pin: 2,  af: 2,  signal: 'TIM5_CH3' },
	{ port: 'A', pin: 2,  af: 3,  signal: 'TIM9_CH1' },
	{ port: 'A', pin: 2,  af: 7,  signal: 'USART2_TX' },
	{ port: 'A', pin: 3,  af: 1,  signal: 'TIM2_CH4' },
	{ port: 'A', pin: 3,  af: 2,  signal: 'TIM5_CH4' },
	{ port: 'A', pin: 3,  af: 3,  signal: 'TIM9_CH2' },
	{ port: 'A', pin: 3,  af: 7,  signal: 'USART2_RX' },
	{ port: 'A', pin: 4,  af: 5,  signal: 'SPI1_NSS' },
	{ port: 'A', pin: 5,  af: 1,  signal: 'TIM2_CH1_ETR' },
	{ port: 'A', pin: 5,  af: 5,  signal: 'SPI1_SCK' },
	{ port: 'A', pin: 6,  af: 2,  signal: 'TIM3_CH1' },
	{ port: 'A', pin: 6,  af: 5,  signal: 'SPI1_MISO' },
	{ port: 'A', pin: 7,  af: 2,  signal: 'TIM3_CH2' },
	{ port: 'A', pin: 7,  af: 5,  signal: 'SPI1_MOSI' },
	{ port: 'A', pin: 8,  af: 1,  signal: 'TIM1_CH1' },
	{ port: 'A', pin: 9,  af: 1,  signal: 'TIM1_CH2' },
	{ port: 'A', pin: 9,  af: 7,  signal: 'USART1_TX' },
	{ port: 'A', pin: 10, af: 1,  signal: 'TIM1_CH3' },
	{ port: 'A', pin: 10, af: 7,  signal: 'USART1_RX' },
	{ port: 'A', pin: 11, af: 7,  signal: 'USART1_CTS' },
	{ port: 'A', pin: 11, af: 10, signal: 'OTG_FS_DM' },
	{ port: 'A', pin: 12, af: 7,  signal: 'USART1_RTS' },
	{ port: 'A', pin: 12, af: 10, signal: 'OTG_FS_DP' },
	{ port: 'B', pin: 6,  af: 4,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 6,  af: 7,  signal: 'USART1_TX' },
	{ port: 'B', pin: 7,  af: 4,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 7,  af: 7,  signal: 'USART1_RX' },
	{ port: 'B', pin: 8,  af: 4,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 9,  af: 4,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 10, af: 4,  signal: 'I2C2_SCL' },
	{ port: 'B', pin: 10, af: 7,  signal: 'USART3_TX' },
	{ port: 'B', pin: 11, af: 4,  signal: 'I2C2_SDA' },
	{ port: 'B', pin: 11, af: 7,  signal: 'USART3_RX' },
	{ port: 'C', pin: 6,  af: 3,  signal: 'TIM8_CH1' },
	{ port: 'C', pin: 6,  af: 8,  signal: 'USART6_TX' },
	{ port: 'C', pin: 7,  af: 3,  signal: 'TIM8_CH2' },
	{ port: 'C', pin: 7,  af: 8,  signal: 'USART6_RX' },
	{ port: 'E', pin: 8,  af: 1,  signal: 'TIM1_CH1N' },
	{ port: 'E', pin: 9,  af: 1,  signal: 'TIM1_CH1' },
	{ port: 'E', pin: 10, af: 1,  signal: 'TIM1_CH2N' },
	{ port: 'E', pin: 11, af: 1,  signal: 'TIM1_CH2' },
	{ port: 'E', pin: 12, af: 1,  signal: 'TIM1_CH3N' },
	{ port: 'E', pin: 13, af: 1,  signal: 'TIM1_CH3' },
	{ port: 'E', pin: 14, af: 1,  signal: 'TIM1_CH4' },
];


// ─── STM32H7 AF Table (RM0433) ────────────────────────────────────────────────
// STM32H74x/H75x — 16 AF values, AXI/AHB/APB architecture.

const STM32H7_AF: IAFEntry[] = [
	{ port: 'A', pin: 0,  af: 1,  signal: 'TIM2_CH1' },
	{ port: 'A', pin: 2,  af: 7,  signal: 'USART2_TX' },
	{ port: 'A', pin: 3,  af: 7,  signal: 'USART2_RX' },
	{ port: 'A', pin: 5,  af: 5,  signal: 'SPI1_SCK' },
	{ port: 'A', pin: 6,  af: 5,  signal: 'SPI1_MISO' },
	{ port: 'A', pin: 7,  af: 5,  signal: 'SPI1_MOSI' },
	{ port: 'A', pin: 9,  af: 7,  signal: 'USART1_TX' },
	{ port: 'A', pin: 10, af: 7,  signal: 'USART1_RX' },
	{ port: 'A', pin: 11, af: 10, signal: 'OTG_FS_DM' },
	{ port: 'A', pin: 12, af: 10, signal: 'OTG_FS_DP' },
	{ port: 'B', pin: 6,  af: 7,  signal: 'USART1_TX' },
	{ port: 'B', pin: 7,  af: 7,  signal: 'USART1_RX' },
	{ port: 'B', pin: 8,  af: 4,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 9,  af: 4,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 10, af: 7,  signal: 'USART3_TX' },
	{ port: 'B', pin: 11, af: 7,  signal: 'USART3_RX' },
	{ port: 'C', pin: 6,  af: 8,  signal: 'USART6_TX' },
	{ port: 'C', pin: 7,  af: 8,  signal: 'USART6_RX' },
	{ port: 'D', pin: 8,  af: 7,  signal: 'USART3_TX' },
	{ port: 'D', pin: 9,  af: 7,  signal: 'USART3_RX' },
	{ port: 'E', pin: 2,  af: 5,  signal: 'SPI4_SCK' },
	{ port: 'E', pin: 5,  af: 5,  signal: 'SPI4_MISO' },
	{ port: 'E', pin: 6,  af: 5,  signal: 'SPI4_MOSI' },
];


// ─── STM32G4 AF Table (RM0440) ────────────────────────────────────────────────
// STM32G4x1/G4x3/G4x4 — 16 AFs, runs up to 170 MHz.

const STM32G4_AF: IAFEntry[] = [
	{ port: 'A', pin: 0,  af: 1,  signal: 'TIM2_CH1' },
	{ port: 'A', pin: 0,  af: 8,  signal: 'UART4_TX' },
	{ port: 'A', pin: 2,  af: 1,  signal: 'TIM2_CH3' },
	{ port: 'A', pin: 2,  af: 7,  signal: 'USART2_TX' },
	{ port: 'A', pin: 3,  af: 1,  signal: 'TIM2_CH4' },
	{ port: 'A', pin: 3,  af: 7,  signal: 'USART2_RX' },
	{ port: 'A', pin: 5,  af: 1,  signal: 'TIM2_CH1_ETR' },
	{ port: 'A', pin: 5,  af: 5,  signal: 'SPI1_SCK' },
	{ port: 'A', pin: 6,  af: 2,  signal: 'TIM3_CH1' },
	{ port: 'A', pin: 6,  af: 5,  signal: 'SPI1_MISO' },
	{ port: 'A', pin: 7,  af: 2,  signal: 'TIM3_CH2' },
	{ port: 'A', pin: 7,  af: 5,  signal: 'SPI1_MOSI' },
	{ port: 'A', pin: 9,  af: 7,  signal: 'USART1_TX' },
	{ port: 'A', pin: 10, af: 7,  signal: 'USART1_RX' },
	{ port: 'A', pin: 11, af: 7,  signal: 'USART1_CTS' },
	{ port: 'A', pin: 12, af: 7,  signal: 'USART1_RTS_DE' },
	{ port: 'B', pin: 6,  af: 7,  signal: 'USART1_TX' },
	{ port: 'B', pin: 7,  af: 7,  signal: 'USART1_RX' },
	{ port: 'B', pin: 8,  af: 4,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 9,  af: 4,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 10, af: 4,  signal: 'I2C2_SCL' },
	{ port: 'B', pin: 11, af: 4,  signal: 'I2C2_SDA' },
	{ port: 'C', pin: 4,  af: 7,  signal: 'USART1_TX' },
	{ port: 'C', pin: 5,  af: 7,  signal: 'USART1_RX' },
];


// ─── STM32F1 AF Table (RM0008) ────────────────────────────────────────────────
// STM32F1 uses AFIO (no AF numbers; remap bits instead). We model AF0 as default,
// AF1 as "remap 1". This is a simplified representation for conflict detection.

const STM32F1_AF: IAFEntry[] = [
	{ port: 'A', pin: 2,  af: 0,  signal: 'USART2_TX' },
	{ port: 'A', pin: 3,  af: 0,  signal: 'USART2_RX' },
	{ port: 'A', pin: 5,  af: 0,  signal: 'SPI1_SCK' },
	{ port: 'A', pin: 6,  af: 0,  signal: 'SPI1_MISO' },
	{ port: 'A', pin: 7,  af: 0,  signal: 'SPI1_MOSI' },
	{ port: 'A', pin: 9,  af: 0,  signal: 'USART1_TX' },
	{ port: 'A', pin: 10, af: 0,  signal: 'USART1_RX' },
	{ port: 'B', pin: 3,  af: 0,  signal: 'SPI1_SCK' },     // remap
	{ port: 'B', pin: 4,  af: 0,  signal: 'SPI1_MISO' },    // remap
	{ port: 'B', pin: 5,  af: 0,  signal: 'SPI1_MOSI' },    // remap
	{ port: 'B', pin: 6,  af: 0,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 6,  af: 1,  signal: 'USART1_TX' },    // remap
	{ port: 'B', pin: 7,  af: 0,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 7,  af: 1,  signal: 'USART1_RX' },    // remap
	{ port: 'B', pin: 8,  af: 0,  signal: 'I2C1_SCL' },     // remap
	{ port: 'B', pin: 9,  af: 0,  signal: 'I2C1_SDA' },     // remap
	{ port: 'B', pin: 10, af: 0,  signal: 'I2C2_SCL' },
	{ port: 'B', pin: 10, af: 1,  signal: 'USART3_TX' },
	{ port: 'B', pin: 11, af: 0,  signal: 'I2C2_SDA' },
	{ port: 'B', pin: 11, af: 1,  signal: 'USART3_RX' },
	{ port: 'B', pin: 13, af: 0,  signal: 'SPI2_SCK' },
	{ port: 'B', pin: 14, af: 0,  signal: 'SPI2_MISO' },
	{ port: 'B', pin: 15, af: 0,  signal: 'SPI2_MOSI' },
	{ port: 'C', pin: 10, af: 0,  signal: 'USART3_TX' },    // remap partial
	{ port: 'C', pin: 11, af: 0,  signal: 'USART3_RX' },    // remap partial
];


// ─── STM32L4 AF Table (RM0394, partial) ──────────────────────────────────────
// STM32L4/L5/WB/WL — similar structure to F4 but LPUART1 replaces USART6.

const STM32L4_AF: IAFEntry[] = [
	{ port: 'A', pin: 2,  af: 7,  signal: 'USART2_TX' },
	{ port: 'A', pin: 3,  af: 7,  signal: 'USART2_RX' },
	{ port: 'A', pin: 5,  af: 5,  signal: 'SPI1_SCK' },
	{ port: 'A', pin: 6,  af: 5,  signal: 'SPI1_MISO' },
	{ port: 'A', pin: 7,  af: 5,  signal: 'SPI1_MOSI' },
	{ port: 'A', pin: 9,  af: 7,  signal: 'USART1_TX' },
	{ port: 'A', pin: 10, af: 7,  signal: 'USART1_RX' },
	{ port: 'B', pin: 6,  af: 7,  signal: 'USART1_TX' },
	{ port: 'B', pin: 7,  af: 7,  signal: 'USART1_RX' },
	{ port: 'B', pin: 8,  af: 4,  signal: 'I2C1_SCL' },
	{ port: 'B', pin: 9,  af: 4,  signal: 'I2C1_SDA' },
	{ port: 'B', pin: 10, af: 7,  signal: 'USART3_TX' },
	{ port: 'B', pin: 11, af: 7,  signal: 'USART3_RX' },
	{ port: 'C', pin: 0,  af: 8,  signal: 'LPUART1_RX' },
	{ port: 'C', pin: 1,  af: 8,  signal: 'LPUART1_TX' },
];
