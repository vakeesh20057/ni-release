/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPeripheralCatalogEntry } from './peripheralCatalogTypes.js';

export const BUILTIN_CATALOG: IPeripheralCatalogEntry[] = [

	// ─── IMU ─────────────────────────────────────────────────────────────────

	{
		partNumber: 'MPU-6050', aliases: ['MPU6050'],
		manufacturer: 'InvenSense/TDK', description: '6-axis IMU: 3-axis gyroscope + 3-axis accelerometer',
		category: 'imu', interfaces: ['i2c'],
		vddMin: 2.375, vddMax: 3.46, i2cAddress: [0x68, 0x69],
		agentHints: [
			'I2C address: 0x68 (AD0=GND) or 0x69 (AD0=VDD)',
			'WHO_AM_I register 0x75 returns 0x68',
			'Initialize: write 0x00 to PWR_MGMT_1 (0x6B) to wake up from sleep',
			'Gyro full scale: ±250/500/1000/2000 dps via GYRO_CONFIG (0x1B)',
			'Accel full scale: ±2/4/8/16 g via ACCEL_CONFIG (0x1C)',
			'Raw data: ACCEL_XOUT_H (0x3B) through GYRO_ZOUT_L (0x48), 6 bytes each',
			'Use DMP for quaternion output; disable for raw data',
		],
		datasheetUrl: 'https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6000-Datasheet1.pdf',
	},
	{
		partNumber: 'MPU-9250', aliases: ['MPU9250'],
		manufacturer: 'InvenSense/TDK', description: '9-axis IMU: gyro + accel + magnetometer (AK8963)',
		category: 'imu', interfaces: ['i2c', 'spi'],
		vddMin: 2.4, vddMax: 3.6, i2cAddress: [0x68, 0x69], spiMode: 3, spiMaxMHz: 1,
		agentHints: [
			'Same register map as MPU-6050 for accel/gyro',
			'Magnetometer (AK8963) accessible via I2C bypass mode or I2C master mode',
			'Enable bypass: INT_PIN_CFG (0x37) bit BYPASS_EN',
			'AK8963 I2C address: 0x0C',
			'SPI: max 1 MHz for setup, 20 MHz for data reads',
		],
		datasheetUrl: 'https://invensense.tdk.com/wp-content/uploads/2015/02/PS-MPU-9250A-01-v1.1.pdf',
	},
	{
		partNumber: 'ICM-42688-P', aliases: ['ICM42688', 'ICM-42688P'],
		manufacturer: 'InvenSense/TDK', description: '6-axis IMU: ±2000 dps gyro + ±16g accel, lowest noise',
		category: 'imu', interfaces: ['i2c', 'spi'],
		vddMin: 1.71, vddMax: 3.6, i2cAddress: [0x68, 0x69], spiMode: 0, spiMaxMHz: 24,
		agentHints: [
			'WHO_AM_I (0x75) = 0x47',
			'Supports 1.8V IO (VDDIO separate from VDD)',
			'ODR up to 32 kHz for accel/gyro',
			'FIFO: 2048 bytes for burst reads',
			'Initialize: PWR_MGMT0 (0x4E) bits ACCEL_MODE=3, GYRO_MODE=3 for LN mode',
		],
		datasheetUrl: 'https://invensense.tdk.com/download-pdf/icm-42688-p-datasheet/',
	},
	{
		partNumber: 'LSM6DSO', aliases: ['LSM6DSOX', 'LSM6DS3'],
		manufacturer: 'STMicroelectronics', description: '6-axis iNEMO IMU with machine learning core',
		category: 'imu', interfaces: ['i2c', 'spi'],
		vddMin: 1.71, vddMax: 3.6, i2cAddress: [0x6A, 0x6B], spiMode: 0, spiMaxMHz: 10,
		agentHints: [
			'WHO_AM_I (0x0F) = 0x6C',
			'I2C address: 0x6A (SDO/SA0=GND), 0x6B (SDO/SA0=VDD)',
			'Enable accel: CTRL1_XL (0x10) = 0x60 (208 Hz, ±2g)',
			'Enable gyro: CTRL2_G (0x11) = 0x60 (208 Hz, ±250 dps)',
			'Read 12 bytes from OUTX_L_G (0x22) for all 6 axes',
			'Machine learning core for gesture recognition without MCU involvement',
		],
	},
	{
		partNumber: 'BNO055',
		manufacturer: 'Bosch', description: 'Absolute orientation 9-axis IMU with onboard sensor fusion',
		category: 'imu', interfaces: ['i2c', 'uart'],
		vddMin: 2.4, vddMax: 3.6, i2cAddress: [0x28, 0x29],
		agentHints: [
			'I2C address: 0x28 (COM3=GND) or 0x29 (COM3=VDD)',
			'Outputs Euler angles, quaternion, linear accel, gravity vector directly',
			'Set to NDOF mode: OPR_MODE (0x3D) = 0x0C',
			'Read quaternion: QUA_DATA_W_LSB (0x20), 8 bytes',
			'Calibration status: CALIB_STAT (0x35)',
			'Built-in Kalman filter — no need for MCU sensor fusion',
		],
	},
	{
		partNumber: 'LSM303DLHC', aliases: ['LSM303AGR'],
		manufacturer: 'STMicroelectronics', description: '6-axis IMU: 3-axis accelerometer + 3-axis magnetometer',
		category: 'imu', interfaces: ['i2c'],
		vddMin: 2.16, vddMax: 3.6, i2cAddress: [0x19, 0x1E],
		agentHints: [
			'Two separate I2C devices: Accel at 0x19, Mag at 0x1E',
			'Enable accel: CTRL_REG1_A (0x20) = 0x57 (100Hz, all axes)',
			'Read accel: OUT_X_L_A (0x28) with auto-increment (set bit 7 of reg addr)',
		],
	},

	// ─── Barometer ───────────────────────────────────────────────────────────

	{
		partNumber: 'BME280', aliases: ['BMP280'],
		manufacturer: 'Bosch', description: 'Temperature + pressure + humidity sensor (BME280) / temperature + pressure (BMP280)',
		category: 'barometer', interfaces: ['i2c', 'spi'],
		vddMin: 1.71, vddMax: 3.6, i2cAddress: [0x76, 0x77], spiMode: 0, spiMaxMHz: 10,
		agentHints: [
			'I2C address: 0x76 (SDO=GND), 0x77 (SDO=VDD)',
			'chip_id register 0xD0: BME280=0x60, BMP280=0x58',
			'Read calibration data from 0x88-0x9F (T, P) and 0xE1-0xE7 (H, BME280 only)',
			'Set mode: ctrl_meas (0xF4) = 0xB7 for forced mode, normal: 0xB7',
			'Read: press_msb (0xF7), temp_msb (0xFA), hum_msb (0xFD) — 8 bytes total',
			'Must apply compensation formula from datasheet to get real values',
			'Bosch BME280 Arduino library available for reference',
		],
		datasheetUrl: 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf',
	},
	{
		partNumber: 'BMP388', aliases: ['BMP390'],
		manufacturer: 'Bosch', description: 'High-precision barometric pressure sensor, ±0.08 hPa',
		category: 'barometer', interfaces: ['i2c', 'spi'],
		vddMin: 1.65, vddMax: 3.6, i2cAddress: [0x76, 0x77], spiMode: 0, spiMaxMHz: 10,
		agentHints: [
			'chip_id (0x00) = 0x50',
			'Enable sensors: PWR_CTRL (0x1B) = 0x33 (pressure + temp on, normal mode)',
			'Read 6 bytes from DATA_0 (0x04): [press_xlsb, press_lsb, press_msb, temp_xlsb, temp_lsb, temp_msb]',
			'Compensate using NVM calibration data from 0x31-0x57',
			'FIFO: 512 bytes for logging applications',
		],
	},
	{
		partNumber: 'MS5611', aliases: ['MS5607'],
		manufacturer: 'TE Connectivity', description: 'High-resolution barometric altimeter, ±1.5 mbar',
		category: 'barometer', interfaces: ['i2c', 'spi'],
		vddMin: 1.8, vddMax: 3.6, i2cAddress: [0x76, 0x77], spiMode: 0, spiMaxMHz: 20,
		agentHints: [
			'Command-based protocol: send ADC conversion command, wait, then read result',
			'Reset: 0x1E; Read PROM: 0xA2-0xAC (6x 16-bit calibration coefficients)',
			'Convert pressure: 0x48 (OSR=4096); Convert temp: 0x58',
			'Read ADC: 0x00 (3 bytes)',
			'Apply second-order temperature compensation formula from datasheet',
		],
	},

	// ─── Temperature ─────────────────────────────────────────────────────────

	{
		partNumber: 'AHT20', aliases: ['AHT21', 'AHT10'],
		manufacturer: 'ASAIR', description: 'Temperature and humidity sensor, ±0.3°C / ±2% RH',
		category: 'temperature', interfaces: ['i2c'],
		vddMin: 2.2, vddMax: 5.5, i2cAddress: [0x38],
		agentHints: [
			'Fixed I2C address: 0x38',
			'Initialize: send 0xBE 0x08 0x00 after power-on delay',
			'Trigger measurement: send 0xAC 0x33 0x00',
			'Wait 80ms for conversion, then read 6 bytes',
			'Byte[0] = status (bit7=busy), Bytes[1-5] = humidity[19:0] + temperature[19:0]',
			'Humidity: (raw_h >> 4) / 2^20 * 100 %',
			'Temperature: (raw_t & 0xFFFFF) / 2^20 * 200 - 50 °C',
		],
	},
	{
		partNumber: 'SHT31', aliases: ['SHT30', 'SHT35', 'SHT40', 'SHT41', 'SHT45'],
		manufacturer: 'Sensirion', description: 'High-accuracy temperature and humidity sensor, ±0.2°C / ±2% RH',
		category: 'temperature', interfaces: ['i2c'],
		vddMin: 2.15, vddMax: 5.5, i2cAddress: [0x44, 0x45],
		agentHints: [
			'I2C address: 0x44 (ADDR pin=GND), 0x45 (ADDR pin=VDD)',
			'Single-shot measurement command: 0x2C 0x06 (high repeatability, clock stretching)',
			'Or periodic: 0x20 0x32 (1 Hz medium repeatability)',
			'Read 6 bytes: [T_MSB, T_LSB, T_CRC, H_MSB, H_LSB, H_CRC]',
			'Temperature: -45 + 175 * raw_T / (2^16-1) °C',
			'Humidity: 100 * raw_H / (2^16-1) %',
			'Verify CRC-8 (polynomial 0x31, init 0xFF) for data integrity',
		],
	},
	{
		partNumber: 'HDC1080',
		manufacturer: 'Texas Instruments', description: 'Temperature and humidity sensor, ±0.2°C / ±2% RH',
		category: 'temperature', interfaces: ['i2c'],
		vddMin: 2.7, vddMax: 5.5, i2cAddress: [0x40],
		agentHints: [
			'Fixed I2C address: 0x40',
			'Device ID register (0xFF) = 0x1050',
			'Configure: write 0x02 to config register (0x02): 14-bit temp+hum, acquisition mode',
			'Trigger: write 0x00 to temperature register, wait 20ms, read 4 bytes',
			'Temperature: raw * 165 / 65536 - 40 °C',
		],
	},
	{
		partNumber: 'MCP9808',
		manufacturer: 'Microchip', description: 'High-accuracy digital temperature sensor, ±0.25°C',
		category: 'temperature', interfaces: ['i2c'],
		vddMin: 2.7, vddMax: 5.5, i2cAddress: [0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F],
		agentHints: [
			'I2C address: 0x18-0x1F (A2/A1/A0 address pins)',
			'Read ambient temperature: register 0x05 (2 bytes)',
			'bit13 = sign, bits 12:0 = temperature in 1/16 °C steps',
			'Negative: temperature = (raw - 4096) / 16.0',
			'Alert window: set T_UPPER (0x02), T_LOWER (0x03), T_CRIT (0x04)',
			'Manufacturer ID (0x06) = 0x0054',
		],
	},
	{
		partNumber: 'TMP117',
		manufacturer: 'Texas Instruments', description: 'Ultra-precise temperature sensor, ±0.1°C accuracy',
		category: 'temperature', interfaces: ['i2c'],
		vddMin: 1.7, vddMax: 5.5, i2cAddress: [0x48, 0x49, 0x4A, 0x4B],
		agentHints: [
			'I2C address: 0x48-0x4B (ADD0/ADD1 pins)',
			'Read temperature register 0x00 (2 bytes, signed 16-bit)',
			'Resolution: 7.8125 m°C per LSB (raw / 128.0 gives °C)',
			'Device ID register 0x0F = 0x0117',
			'Alert function with threshold registers',
		],
	},
	{
		partNumber: 'DS18B20',
		manufacturer: 'Maxim/Dallas', description: '1-Wire digital temperature sensor, ±0.5°C, parasitic power capable',
		category: 'temperature', interfaces: ['one-wire'],
		vddMin: 3.0, vddMax: 5.5,
		agentHints: [
			'1-Wire protocol: 480µs reset pulse, then presence pulse from sensor',
			'Commands: 0xCC (skip ROM, single device), 0x44 (convert T), 0xBE (read scratchpad)',
			'Wait 750ms for 12-bit conversion, then read 9 bytes',
			'Temperature bytes: scratchpad[0] (LSB) + scratchpad[1] (MSB), signed 16-bit / 16.0',
			'Each sensor has unique 64-bit ROM code — use 0x55 (match ROM) for multi-sensor bus',
			'Parasitic power: use strong pull-up on DQ line during conversion',
		],
	},

	// ─── Display ─────────────────────────────────────────────────────────────

	{
		partNumber: 'SSD1306',
		manufacturer: 'Solomon Systech', description: '128x64 or 128x32 OLED display controller',
		category: 'display', interfaces: ['i2c', 'spi'],
		vddMin: 1.65, vddMax: 3.3, i2cAddress: [0x3C, 0x3D], spiMode: 0, spiMaxMHz: 10,
		agentHints: [
			'I2C: 0x3C (SA0=GND), 0x3D (SA0=VDD)',
			'All commands preceded by 0x00 (command byte) or 0x40 (data byte) control byte',
			'Initialize sequence: 0xAE (off), 0xD5 0x80, 0xA8 0x3F, 0xD3 0x00, 0x40, 0xA1, 0xC8, 0xDA 0x12, 0x81 0xCF, 0xD9 0xF1, 0xDB 0x40, 0xA4, 0xA6, 0x2E, 0xAF (on)',
			'Set column address: 0x21 start end; Set page address: 0x22 start end',
			'Write pixel data as 8-bit column bytes, LSB = top of page',
			'Frame buffer: 128*8/8 = 1024 bytes for 128x64',
		],
	},
	{
		partNumber: 'ST7789', aliases: ['ST7735'],
		manufacturer: 'Sitronix', description: '240x240 or 135x240 TFT LCD color display controller',
		category: 'display', interfaces: ['spi'],
		vddMin: 2.4, vddMax: 3.3, spiMode: 0, spiMaxMHz: 80,
		agentHints: [
			'SPI + DC (data/command) + RST pins required',
			'DC=LOW for commands, DC=HIGH for data',
			'Init: SWRESET (0x01), SLPOUT (0x11), COLMOD (0x3A) 0x55 (16-bit color), MADCTL (0x36)',
			'Set window: CASET (0x2A) [x0_hi, x0_lo, x1_hi, x1_lo], RASET (0x2B) same for Y',
			'Write pixels: RAMWR (0x2C), then 16-bit RGB565 data',
			'DMA transfer for display updates: set window once, DMA RAMWR data',
			'Backlight via PWM on separate pin',
		],
	},
	{
		partNumber: 'ILI9341',
		manufacturer: 'Ilitek', description: '240x320 TFT LCD color display controller, most common',
		category: 'display', interfaces: ['spi'],
		vddMin: 2.4, vddMax: 3.3, spiMode: 0, spiMaxMHz: 60,
		agentHints: [
			'Init: SWRESET, then large initialization sequence (see datasheet Table 7)',
			'COLMOD (0x3A) 0x55 for 16-bit RGB565',
			'MADCTL (0x36) 0x48 for landscape mode',
			'Column/row set: 0x2A / 0x2B with 4-byte param [0, start_hi, start_lo, end_hi, end_lo]',
			'2-byte color: bits [15:11]=R, [10:5]=G, [4:0]=B (RGB565)',
			'Uses same protocol as ST7789 but different init sequence and max 60 MHz',
		],
	},
	{
		partNumber: 'SSD1351',
		manufacturer: 'Solomon Systech', description: '128x128 OLED color display controller',
		category: 'display', interfaces: ['spi'],
		vddMin: 2.4, vddMax: 3.5, spiMode: 0, spiMaxMHz: 20,
		agentHints: [
			'128x128 16-bit RGB565 color OLED',
			'Init: 0xFD 0x12 (unlock), 0xAE (sleep), 0xB3 0xF1 (clock), 0xCA 0x7F, 0xA2 0x00, 0xB5 0x00, 0xA6 (normal), 0xC7 0x0F (contrast), 0xAF (on)',
			'Set window: 0x15 [col_start, col_end], 0x75 [row_start, row_end]',
			'Write pixels: 0x5C, then 16-bit RGB565 data',
		],
	},

	// ─── Flash Memory ─────────────────────────────────────────────────────────

	{
		partNumber: 'W25Q128', aliases: ['W25Q64', 'W25Q32', 'W25Q16', 'W25Q256'],
		manufacturer: 'Winbond', description: '128Mbit (16MB) SPI NOR flash memory',
		category: 'flash', interfaces: ['spi'],
		vddMin: 2.7, vddMax: 3.6, spiMode: 0, spiMaxMHz: 133,
		agentHints: [
			'JEDEC ID: 0xEF 0x40 0x18 (W25Q128)',
			'Read JEDEC ID: 0x9F, read 3 bytes',
			'Read data: 0x03 [addr24] [data...]',
			'Fast read: 0x0B [addr24] [dummy] [data...]',
			'Page program (256 bytes max): 0x02 [addr24] [data]. Must write-enable first: 0x06',
			'Sector erase (4KB): 0x20 [addr24]. Block erase (64KB): 0xD8',
			'Wait: read status register (0x05) bit0 = BUSY',
			'Quad SPI: 0x38 command for 4x speed writes',
		],
	},
	{
		partNumber: 'AT24C256', aliases: ['AT24C64', 'AT24C32', 'AT24C512', 'M24C64'],
		manufacturer: 'Microchip/Atmel', description: '256Kbit (32KB) I2C EEPROM',
		category: 'eeprom', interfaces: ['i2c'],
		vddMin: 1.7, vddMax: 5.5, i2cAddress: [0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57],
		agentHints: [
			'I2C address: 0x50-0x57 (A2/A1/A0 address pins)',
			'Write byte: address MSB, address LSB, data (2-byte word address for 256K)',
			'Write page (64 bytes max): address MSB, address LSB, up to 64 data bytes',
			'After write: poll with I2C start — ACK means write complete (5ms max)',
			'Sequential read: send address, then read N bytes (auto-increments)',
			'Write protect: WP pin HIGH = write protected',
		],
	},

	// ─── ADC / DAC ────────────────────────────────────────────────────────────

	{
		partNumber: 'ADS1115', aliases: ['ADS1015'],
		manufacturer: 'Texas Instruments', description: '16-bit (12-bit for ADS1015) 4-channel I2C ADC, PGA',
		category: 'adc', interfaces: ['i2c'],
		vddMin: 2.0, vddMax: 5.5, i2cAddress: [0x48, 0x49, 0x4A, 0x4B],
		agentHints: [
			'I2C address: 0x48 (ADDR=GND), 0x49 (ADDR=VDD), 0x4A (ADDR=SDA), 0x4B (ADDR=SCL)',
			'Config register (0x01): MUX[14:12] + PGA[11:9] + MODE[8] + DR[7:5] + COMP[4:0]',
			'PGA: ±6.144V=0, ±4.096V=1, ±2.048V=2, ±1.024V=4, ±0.512V=5, ±0.256V=6',
			'Start conversion: write config with OS bit (15) = 1',
			'Read result: register 0x00 (2 bytes, signed 16-bit)',
			'Differential inputs: AIN0/AIN1=MUX[000], AIN0/AIN3=MUX[001], etc.',
			'Single-shot vs continuous mode via MODE bit',
		],
	},
	{
		partNumber: 'MCP4725',
		manufacturer: 'Microchip', description: '12-bit single-channel I2C DAC with EEPROM',
		category: 'dac', interfaces: ['i2c'],
		vddMin: 2.7, vddMax: 5.5, i2cAddress: [0x60, 0x61],
		agentHints: [
			'I2C address: 0x60 (A0=GND), 0x61 (A0=VDD)',
			'Write fast mode: [0x00 | (D11:D8)] [D7:D0] (2 bytes, no EEPROM write)',
			'Write DAC + EEPROM: [0x60] [D11:D4] [D3:D0 | 0x00] (3 bytes)',
			'Output voltage: Vout = Vdd * D / 4096',
			'Power-down modes: PD1/PD0 bits in command byte',
		],
	},
	{
		partNumber: 'ADS7828',
		manufacturer: 'Texas Instruments', description: '12-bit 8-channel I2C ADC',
		category: 'adc', interfaces: ['i2c'],
		vddMin: 2.7, vddMax: 5.25, i2cAddress: [0x48, 0x49, 0x4A, 0x4B],
		agentHints: [
			'Send command byte: CH[7:6] | 0x84 (internal ref, on) | addr_bits',
			'CH: 00=CH0, 01=CH1... 11=CH7',
			'Read 2 bytes: [D11:D8] [D7:D0] (12-bit result)',
		],
	},

	// ─── Motor Drivers ────────────────────────────────────────────────────────

	{
		partNumber: 'DRV8833',
		manufacturer: 'Texas Instruments', description: 'Dual H-bridge motor driver, 1.5A/channel, 2-10V',
		category: 'motor-driver', interfaces: ['pwm', 'gpio'],
		vddMin: 2.7, vddMax: 10.8,
		agentHints: [
			'IN1/IN2 per motor: 10=forward, 01=reverse, 00=coast, 11=brake',
			'Speed via PWM on IN1 or IN2 (0-100% duty cycle)',
			'nSLEEP pin: LOW=sleep (low power), HIGH=active',
			'nFAULT: open-drain output, LOW on overcurrent/thermal shutdown',
			'Stall detection via nFAULT + current sensing resistor on xISEN pin',
			'Up to 1.5A per channel, 3A peak',
		],
	},
	{
		partNumber: 'DRV8825',
		manufacturer: 'Texas Instruments', description: 'Stepper motor driver, 1/32 microstepping, 2.5A',
		category: 'stepper', interfaces: ['gpio', 'pwm'],
		vddMin: 8.2, vddMax: 45,
		agentHints: [
			'STEP pin: rising edge = one microstep',
			'DIR pin: HIGH=CW, LOW=CCW',
			'ENABLE: LOW=enabled, HIGH=disabled (coils off)',
			'MS1/MS2/MS3 microstepping: 000=full, 001=half, 010=1/4, 011=1/8, 111=1/32',
			'Set current limit via VREF: I_trip = VREF / (5 * Rsense)',
			'nRESET: LOW to reset internals; nSLEEP: LOW for sleep mode',
			'Pulse width min: 2µs step, 1µs dir before step',
		],
	},
	{
		partNumber: 'TMC2209',
		manufacturer: 'Trinamic/Analog Devices', description: 'Silent stepper motor driver, UART config, stall detection',
		category: 'stepper', interfaces: ['uart', 'gpio', 'pwm'],
		vddMin: 4.75, vddMax: 29, uart: { baudRate: 500000, format: '8N1' },
		agentHints: [
			'Single-wire UART (PDN_UART pin) at 500 kbaud for configuration',
			'StealthChop (silent): default mode, no audible noise',
			'SpreadCycle (high torque): enable via CHOPCONF register',
			'StallGuard4: sensorless homing via SGT threshold in COOLCONF',
			'STEP/DIR interface same as other Trinamic drivers',
			'Set current: IRUN/IHOLD in IHOLD_IRUN register (0-31 scale)',
			'UART address set by MS1/MS2 during reset: 0x00, 0x01, 0x02, 0x03',
		],
	},
	{
		partNumber: 'A4988',
		manufacturer: 'Allegro', description: 'Stepper motor driver, 1/16 microstepping, 2A, common RepRap',
		category: 'stepper', interfaces: ['gpio', 'pwm'],
		vddMin: 8, vddMax: 35,
		agentHints: [
			'Same STEP/DIR/ENABLE/MS1/MS2/MS3 interface as DRV8825',
			'MS1/MS2/MS3: 000=full, 001=half, 010=1/4, 011=1/8, 111=1/16',
			'Current limit: Vref = I_trip * 8 * Rsense (typical Rsense=0.1Ω)',
			'RESET: LOW to reset; SLEEP: LOW for sleep',
			'Step pulse: 1µs minimum',
		],
	},

	// ─── Wireless Transceivers ────────────────────────────────────────────────

	{
		partNumber: 'nRF24L01+', aliases: ['nRF24L01'],
		manufacturer: 'Nordic Semiconductor', description: '2.4 GHz ISM band transceiver, 2 Mbps, 125 channels',
		category: 'transceiver', interfaces: ['spi'],
		vddMin: 1.9, vddMax: 3.6, spiMode: 0, spiMaxMHz: 10,
		agentHints: [
			'SPI + CE (chip enable) + IRQ pins',
			'Registers accessed via SPI: [cmd] [data]',
			'Write register: 0x20 | reg_addr',
			'Read register: reg_addr (bit7=0)',
			'Initialize: CONFIG=0x0B, EN_AA=0x3F, EN_RXADDR=0x01, RF_CH=76, RF_SETUP=0x0F',
			'TX: write TX_ADDR (0x10), write payload (0xA0), toggle CE high >10µs',
			'RX: set PRX bit in CONFIG, CE high for receive mode',
			'IRQ: STATUS register 0x07 flags: TX_DS, MAX_RT, RX_DR',
		],
	},
	{
		partNumber: 'RFM95W', aliases: ['RFM96W', 'SX1276'],
		manufacturer: 'HopeRF/Semtech', description: 'LoRa/FSK 433/868/915 MHz transceiver, 20 dBm, long range',
		category: 'transceiver', interfaces: ['spi'],
		vddMin: 1.8, vddMax: 3.7, spiMode: 0, spiMaxMHz: 10,
		agentHints: [
			'SPI registers: write = 0x80 | reg, read = reg',
			'LoRa mode: RegOpMode (0x01) bit7=1 (LoRa)',
			'Frequency: Frf = Fstep * (RegFrfMsb:Mid:Lsb), Fstep = 32MHz / 2^19',
			'BW/CR/SF: RegModemConfig1 (0x1D), RegModemConfig2 (0x1E)',
			'FIFO: 256 bytes. TX: write to FIFO (0x00), set FifoTxBaseAddr, send',
			'TX: RegOpMode = 0x83 (LoRa + TX mode)',
			'IRQ: RegIrqFlags (0x12): TxDone=bit3, RxDone=bit6, CrcError=bit5',
		],
	},
	{
		partNumber: 'CC1101',
		manufacturer: 'Texas Instruments', description: 'Sub-1 GHz (315/433/868/915 MHz) ISM transceiver',
		category: 'transceiver', interfaces: ['spi'],
		vddMin: 1.8, vddMax: 3.6, spiMode: 0, spiMaxMHz: 9,
		agentHints: [
			'SPI: command strobes are single-byte, burst bit7 | R/W bit6 | addr[5:0]',
			'Power up strobe: 0x30 (SRES), then configure registers',
			'PARTNUM (0x30) = 0x00, VERSION (0x31) = 0x14',
			'Configure frequency, data rate, modulation via FREQ2/1/0, MDMCFG* registers',
			'TX: write payload to TX FIFO (0x7F burst), strobe STX (0x35)',
			'RX: strobe SRX (0x34), check RXBYTES, read FIFO',
		],
	},

	// ─── RTC ─────────────────────────────────────────────────────────────────

	{
		partNumber: 'DS3231', aliases: ['DS3232'],
		manufacturer: 'Maxim/Analog Devices', description: 'Extremely accurate I2C RTC with temperature-compensated oscillator',
		category: 'rtc', interfaces: ['i2c'],
		vddMin: 2.3, vddMax: 5.5, i2cAddress: [0x68],
		agentHints: [
			'Fixed I2C address: 0x68',
			'Registers 0x00-0x06: seconds, minutes, hours, day, date, month/century, year (BCD format)',
			'Alarm 1: 0x07-0x0A; Alarm 2: 0x0B-0x0D',
			'Control (0x0E): BBSQW, CONV, RS2/RS1, INTCN, A2IE, A1IE',
			'Status (0x0F): OSF, EN32kHz, BSY, A2F, A1F',
			'Temperature: 0x11 (MSB, 0.25°C LSB), 0x12 (fraction bits 7:6)',
			'Backup battery: 3V coin cell on Vbat pin maintains time during main power loss',
		],
	},
	{
		partNumber: 'PCF8523', aliases: ['PCF8563'],
		manufacturer: 'NXP', description: 'Real-time clock/calendar with alarm and timer',
		category: 'rtc', interfaces: ['i2c'],
		vddMin: 1.8, vddMax: 5.5, i2cAddress: [0x68],
		agentHints: [
			'Fixed I2C address: 0x68',
			'Control_1 (0x00): STOP bit must be cleared to start oscillator',
			'Time registers 0x03-0x09: seconds, minutes, hours, days, weekdays, months, years',
			'BCD format — convert with (val & 0x0F) + ((val >> 4) * 10)',
			'Oscillator calibration: CAP_SEL bit for 7 or 12.5 pF crystal',
		],
	},

	// ─── Distance / ToF ───────────────────────────────────────────────────────

	{
		partNumber: 'VL53L1X', aliases: ['VL53L0X'],
		manufacturer: 'STMicroelectronics', description: 'Time-of-Flight distance sensor, 4m range, 940nm laser',
		category: 'distance', interfaces: ['i2c'],
		vddMin: 2.6, vddMax: 3.5, i2cAddress: [0x29],
		agentHints: [
			'Fixed I2C address: 0x29 (change via software + XSHUT if multiple sensors)',
			'Use STM32 VL53L1X Ultra Lite Driver (ULD) for initialization (complex calibration)',
			'Simplified: SYSTEM_START (0x00) = 0x40 (init), then poll RANGE_STATUS (0x0089)',
			'Read distance: RESULT_RANGE_MM (0x0096) 2 bytes',
			'Short range mode (1.3m): DISTANCE_MODE = 1; Long range (4m): = 2',
			'Ranging interrupt: GPIO__TIO_HV_STATUS = active high on data ready',
		],
	},
	{
		partNumber: 'HC-SR04',
		manufacturer: 'Various', description: 'Ultrasonic distance sensor, 2-400cm, non-contact',
		category: 'distance', interfaces: ['gpio'],
		vddMin: 5.0, vddMax: 5.0,
		agentHints: [
			'Trigger: 10µs HIGH pulse on TRIG pin',
			'Echo: measure HIGH pulse width on ECHO pin',
			'Distance = pulse_width_us * 0.034 / 2 (cm)',
			'Typical: trigger, wait 60ms, trigger again (max 40 Hz)',
			'Echo output is 5V — use voltage divider (5V->3.3V) for 3.3V MCUs',
			'Use timer capture mode for accurate pulse width measurement',
		],
	},

	// ─── Light / Color ────────────────────────────────────────────────────────

	{
		partNumber: 'APDS9960',
		manufacturer: 'Avago/Broadcom', description: 'Color, proximity, gesture, and ambient light sensor',
		category: 'gesture', interfaces: ['i2c'],
		vddMin: 2.4, vddMax: 3.6, i2cAddress: [0x39],
		agentHints: [
			'Fixed I2C address: 0x39',
			'WHO_AM_I (0x92) = 0xAB',
			'Enable proximity: ENABLE (0x80) = 0x05 (PON + PEN)',
			'Enable gesture: ENABLE (0x80) = 0x41 (PON + GEN)',
			'Enable color: ENABLE (0x80) = 0x03 (PON + AEN)',
			'Proximity data: PDATA (0x9C)',
			'Gesture FIFO: read GFLVL (0xAE) then GFIFO_U/D/L/R (0xFC-0xFF)',
			'INT_ENABLE: interrupt on threshold cross',
		],
	},
	{
		partNumber: 'TSL2591',
		manufacturer: 'ams', description: 'High dynamic range digital ambient light sensor',
		category: 'light', interfaces: ['i2c'],
		vddMin: 2.7, vddMax: 3.6, i2cAddress: [0x29],
		agentHints: [
			'Fixed I2C address: 0x29',
			'Command byte: 0xA0 | register',
			'ID register (0x12) = 0x50',
			'Enable: ENABLE (0x00) = 0x03 (AEN | PON)',
			'Set gain/integration: CONTROL (0x01)',
			'Read CH0 (full spectrum): 0x14/0x15; CH1 (IR): 0x16/0x17',
			'Lux: (CH0_raw - CH1_raw) * (0.000110 * cpl_factor) / gain',
		],
	},

	// ─── Heart Rate ───────────────────────────────────────────────────────────

	{
		partNumber: 'MAX30102', aliases: ['MAX30105'],
		manufacturer: 'Maxim/Analog Devices', description: 'Heart rate and SpO2 sensor with red + IR LEDs',
		category: 'heartrate', interfaces: ['i2c'],
		vddMin: 1.7, vddMax: 2.0, i2cAddress: [0x57],
		agentHints: [
			'Fixed I2C address: 0x57',
			'PART_ID (0xFF) = 0x15',
			'Reset: MODE_CONFIG (0x09) = 0x40 (RESET bit)',
			'FIFO_AVG: 0x08 (16 samples averaged)',
			'LED pulse amplitude: LED1_PA (0x0C) red, LED2_PA (0x0D) IR (0x1F = 6.4mA)',
			'Mode: SpO2 = 0x03 in MODE_CONFIG',
			'FIFO: 32-sample FIFO, each sample = 3 bytes per LED',
			'Read FIFO: check OVERFLOW_CTR (0x07), read from FIFO_DATA (0x07)',
			'Run Maxim SpO2 algorithm library for HR/SpO2 from raw samples',
		],
	},

	// ─── Current Sense ────────────────────────────────────────────────────────

	{
		partNumber: 'INA226', aliases: ['INA219', 'INA3221'],
		manufacturer: 'Texas Instruments', description: 'Current/voltage/power monitor via I2C, 36V max',
		category: 'current-sense', interfaces: ['i2c'],
		vddMin: 2.7, vddMax: 5.5, i2cAddress: [0x40, 0x41, 0x44, 0x45],
		agentHints: [
			'I2C address set by A0/A1 pins: 0x40 (GND/GND) to 0x4F',
			'Calibration register: CAL = 0.00512 / (CurrentLSB * Rshunt)',
			'Current LSB: choose e.g. 0.0001 A (100µA per bit)',
			'Read bus voltage: BUS_VOLTAGE (0x02), multiply by 1.25 mV',
			'Read current: CURRENT (0x04), multiply by CurrentLSB',
			'Read power: POWER (0x03), multiply by 25 * CurrentLSB',
			'Alert: set ALERT_LIMIT and MASK/ENABLE register for overcurrent interrupt',
		],
	},

	// ─── IO Expander ─────────────────────────────────────────────────────────

	{
		partNumber: 'MCP23017', aliases: ['MCP23S17'],
		manufacturer: 'Microchip', description: '16-bit I2C/SPI GPIO expander with interrupt support',
		category: 'io-expander', interfaces: ['i2c', 'spi'],
		vddMin: 1.8, vddMax: 5.5, i2cAddress: [0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27],
		agentHints: [
			'I2C address: 0x20-0x27 (A2/A1/A0 address pins)',
			'IODIRA (0x00) / IODIRB (0x01): 1=input, 0=output',
			'OLATA (0x14) / OLATB (0x15): output latch',
			'GPIOA (0x12) / GPIOB (0x13): read port state',
			'GPPUA (0x0C) / GPPUB (0x0D): pull-up resistors',
			'Interrupt: GPINTENA/B (0x04/0x05), INTFA/B (0x0E/0x0F)',
			'IOCON (0x0A): BANK bit changes register addressing scheme',
		],
	},
	{
		partNumber: 'PCF8574', aliases: ['PCF8574A'],
		manufacturer: 'NXP/TI', description: '8-bit I2C GPIO expander, quasi-bidirectional',
		category: 'io-expander', interfaces: ['i2c'],
		vddMin: 2.5, vddMax: 6.0, i2cAddress: [0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27],
		agentHints: [
			'No register address — single byte read/write directly from/to GPIO port',
			'Write: send 1 byte with desired output state (0=low, 1=high/input)',
			'Read: request 1 byte — pins configured as input are pulled high',
			'Interrupt: INT pin goes LOW when any input changes',
			'PCF8574A: address range 0x38-0x3F',
		],
	},

	// ─── GPS ─────────────────────────────────────────────────────────────────

	{
		partNumber: 'NEO-6M', aliases: ['NEO-8M', 'NEO-M9N', 'u-blox 6'],
		manufacturer: 'u-blox', description: 'GPS/GNSS receiver module, NMEA/UBX protocol',
		category: 'gps', interfaces: ['uart'],
		vddMin: 3.0, vddMax: 3.6, uart: { baudRate: 9600, format: '8N1' },
		agentHints: [
			'Default UART: 9600 baud 8N1',
			'NMEA sentences: $GPRMC (position+time), $GPGGA (altitude+fix), $GPGSV (satellites)',
			'Parse GPRMC: $GPRMC,time,A/V,lat,N/S,lon,E/W,speed,course,date,...',
			'UBX binary protocol for configuration (faster than NMEA)',
			'Configure rate: UBX-CFG-RATE (0x06 0x08) for 10 Hz updates',
			'Fix indicator: GPRMC field 2 = A (active/fix) or V (void/no fix)',
			'Typical TTFF: cold=30s, hot=1s with AGPS',
		],
	},

	// ─── Audio ────────────────────────────────────────────────────────────────

	{
		partNumber: 'MAX98357A', aliases: ['MAX98357B'],
		manufacturer: 'Maxim/Analog Devices', description: 'I2S PCM Class D amplifier, 3.2W, no I2C needed',
		category: 'audio', interfaces: ['i2s'],
		vddMin: 2.5, vddMax: 5.5,
		agentHints: [
			'I2S input: BCLK, LRCLK (word select), DIN',
			'No configuration register — driven entirely by I2S stream',
			'SD_MODE pin: pull HIGH=L-channel, pull to mid=stereo mix, pull LOW=R-channel',
			'GAIN pin: float=9dB, 100k to GND=12dB, 100k to VDD=15dB, GND=6dB',
			'Configure MCU I2S: 16-bit or 32-bit, 44.1 kHz or 48 kHz sample rate',
		],
	},

	// ─── Power Management ─────────────────────────────────────────────────────

	{
		partNumber: 'LTC4150', aliases: ['LC709203F'],
		manufacturer: 'Analog Devices', description: 'Coulomb counter for battery monitoring',
		category: 'power-management', interfaces: ['i2c'],
		vddMin: 1.8, vddMax: 5.0, i2cAddress: [0x0B],
		agentHints: [
			'Fixed I2C address: 0x0B',
			'Read cell voltage: 0x09 (2 bytes, 10-bit, * 2.2 mV/count)',
			'Read RSOC (remaining capacity): 0x0D',
			'Read cell temperature: 0x08 (0.1 °C/count)',
			'Accurate for LiPo: set CELL_TEMP_MODE bit',
		],
	},
];
