/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { ILogicAnalyzerService } from '../instruments/logicAnalyzer/logicAnalyzerService.js';
import { ILogicChannel, IProtocolConfig, LogicProtocol } from '../instruments/logicAnalyzer/logicAnalyzerTypes.js';


export function buildLogicAnalyzerTools(
	session: IFirmwareSessionService,
	la: ILogicAnalyzerService,
): IVoidInternalTool[] {
	return [
		_fwLaStatus(la),
		_fwLaCapture(session, la),
		_fwLaDecode(session, la),
		_fwLaTrigger(session, la),
		_fwLaExport(la),
	];
}


function _fwLaStatus(la: ILogicAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_la_status',
		description: 'Detect connected logic analyzer and report status. Checks for Saleae Logic 2 (automation port 10430) and Digilent WaveForms. Returns backend type, channel count, max sample rate, and supported protocol decoders.',
		params: {},
		execute: async () => {
			const status = await la.detect();

			if (!status.connected) {
				return [
					`Logic analyzer: NOT DETECTED`,
					``,
					`To connect:`,
					`  Saleae Logic 2: Start Logic 2, go to Preferences > Logic Automation and enable on port 10430.`,
					`  Digilent WaveForms: Connect device via USB. Install: pip install dwf`,
					``,
					`Supported: Saleae Logic 2 (23 decoders) and Digilent WaveForms (11 decoders).`,
					status.error ? `\nError: ${status.error}` : '',
				].join('\n');
			}

			const lines = [
				`Logic Analyzer: ${status.backend.toUpperCase()} (connected)`,
				`Channels: ${status.availableChannels}`,
				`Max sample rate: ${status.maxSampleRateMHz} MHz`,
				``,
				`Supported protocol decoders (${status.supportedProtocols.length}):`,
				`  ${status.supportedProtocols.join(', ')}`,
				``,
				`Next steps:`,
				`  fw_la_capture({ channels: [{id:0, label:"SDA", threshold:1.65, pullup:false}], durationSec:2, sampleRate:12000000 })`,
				`  fw_la_decode({ captureId: "<id>", protocol: "i2c", clockChannel: 1, dataChannel: 0 })`,
			];

			return lines.join('\n');
		},
	};
}


function _fwLaCapture(session: IFirmwareSessionService, la: ILogicAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_la_capture',
		description: 'Capture digital channels for a specified duration. Specify channels as an array with id (0-15), label, threshold voltage (e.g. 1.65 for 3.3V logic), and pullup. Returns a captureId for use with fw_la_decode.',
		params: {
			channels: { description: 'Array of channel configs: [{id: 0, label: "SDA", threshold: 1.65, pullup: false}, ...]' },
			durationSec: { description: 'Capture duration in seconds (0.1-3600). Default: 2.' },
			sampleRate: { description: 'Sample rate in Hz. Default: 12000000 (12 MHz). Max depends on backend and channel count.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const durationSec = typeof args.durationSec === 'number' ? args.durationSec : 2;
			const sampleRate = typeof args.sampleRate === 'number' ? args.sampleRate : 12000000;

			let channels: ILogicChannel[];
			if (Array.isArray(args.channels)) {
				channels = (args.channels as Array<Record<string, unknown>>).map(c => ({
					id: Number(c['id'] ?? 0),
					label: String(c['label'] ?? `CH${c['id'] ?? 0}`),
					threshold: Number(c['threshold'] ?? 1.65),
					pullup: Boolean(c['pullup'] ?? false),
				}));
			} else {
				// Default: capture channels 0 and 1 with 3.3V threshold
				channels = [
					{ id: 0, label: 'CH0', threshold: 1.65, pullup: false },
					{ id: 1, label: 'CH1', threshold: 1.65, pullup: false },
				];
			}

			const capture = await la.captureChannels(channels, durationSec, sampleRate);

			return [
				`Capture complete: ${capture.captureId}`,
				`Backend: ${capture.backend} | Channels: ${channels.map(c => c.label).join(', ')}`,
				`Duration: ${capture.durationSec}s | Sample rate: ${(capture.sampleRate / 1e6).toFixed(1)} MHz`,
				`Samples per channel: ${Math.round(capture.sampleRate * capture.durationSec).toLocaleString()}`,
				``,
				`Next step — decode a protocol:`,
				`  fw_la_decode({ captureId: "${capture.captureId}", protocol: "i2c", dataChannel: 0, clockChannel: 1 })`,
				`  fw_la_decode({ captureId: "${capture.captureId}", protocol: "uart", baudRate: 115200 })`,
				`  fw_la_decode({ captureId: "${capture.captureId}", protocol: "spi", dataChannel: 0, clockChannel: 2, csChannel: 3 })`,
			].join('\n');
		},
	};
}


function _fwLaDecode(session: IFirmwareSessionService, la: ILogicAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_la_decode',
		description: 'Decode a protocol on a previously captured waveform. Specify the capture ID, protocol type, and channel mapping. Returns decoded frames with timestamps, data bytes, addresses, and any framing errors.',
		params: {
			captureId: { description: 'Capture ID from fw_la_capture, e.g. "la_1234567890"' },
			protocol: { description: 'Protocol: uart, spi, i2c, can, lin, i2s, jtag, swd, manchester, modbus, 1-wire' },
			baudRate: { description: 'Baud rate for UART/CAN/LIN (Hz). Default: 115200.' },
			clockChannel: { description: 'Clock channel ID for SPI/I2C/JTAG.' },
			dataChannel: { description: 'Data channel ID (SDA for I2C, MOSI for SPI, TDI for JTAG).' },
			csChannel: { description: 'Chip select channel for SPI.' },
			bitOrder: { description: 'Bit order for SPI: "msb" or "lsb". Default: "msb".' },
		},
		execute: async (args: Record<string, unknown>) => {
			const captureId = String(args.captureId ?? '');
			if (!captureId) { return 'Provide captureId from fw_la_capture.'; }

			const protocol = String(args.protocol ?? 'uart') as LogicProtocol;
			const config: IProtocolConfig = {
				protocol,
				baudRate: typeof args.baudRate === 'number' ? args.baudRate : 115200,
				clockChannel: typeof args.clockChannel === 'number' ? args.clockChannel : 1,
				dataChannel: typeof args.dataChannel === 'number' ? args.dataChannel : 0,
				csChannel: typeof args.csChannel === 'number' ? args.csChannel : 3,
				bitOrder: args.bitOrder === 'lsb' ? 'lsb' : 'msb',
			};

			const frames = await la.decodeProtocol(captureId, config);

			if (frames.length === 0) {
				return [
					`No ${protocol.toUpperCase()} frames found in capture ${captureId}.`,
					``,
					`Possible causes:`,
					`  - No activity on captured channels during the capture window`,
					`  - Wrong threshold voltage (signal not crossing logic threshold)`,
					`  - Wrong baud rate / bit timing — check with oscilloscope`,
					`  - Wrong channel assignment — verify SDA/SCL or MOSI/SCK pins`,
				].join('\n');
			}

			const errorCount = frames.filter(f => f.error).length;
			const lines: string[] = [
				`${protocol.toUpperCase()} decode: ${frames.length} frames${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
				``,
				`Timestamp    Addr    Data                    ASCII`,
				`${'─'.repeat(70)}`,
			];

			const MAX_DISPLAY = 50;
			for (const frame of frames.slice(0, MAX_DISPLAY)) {
				const ts = `${frame.timestamp.toFixed(6)}s`.padEnd(13);
				const addr = frame.address !== undefined ? `0x${frame.address.toString(16).toUpperCase().padStart(2, '0')}`.padEnd(8) : '        ';
				const data = frame.dataHex.padEnd(24);
				const ascii = frame.dataAscii;
				const err = frame.error ? ` [ERROR: ${frame.error}]` : '';
				lines.push(`${ts}${addr}${data}${ascii}${err}`);
			}

			if (frames.length > MAX_DISPLAY) {
				lines.push(`... and ${frames.length - MAX_DISPLAY} more frames`);
			}

			lines.push('');
			lines.push(`Export: fw_la_export({ captureId: "${captureId}" })`);

			return lines.join('\n');
		},
	};
}


function _fwLaTrigger(session: IFirmwareSessionService, la: ILogicAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_la_trigger',
		description: 'Arm a digital edge trigger on a specific channel, then automatically capture after the trigger fires. Useful for capturing infrequent events (button presses, interrupt edges, error conditions).',
		params: {
			channel: { description: 'Channel to trigger on (0-15).' },
			edge: { description: 'Trigger edge: "rising", "falling", or "either". Default: "rising".' },
			captureChannels: { description: 'Channels to capture after trigger: [{id:0, label:"SDA", threshold:1.65, pullup:false}, ...]' },
			durationSec: { description: 'Capture duration after trigger fires (seconds). Default: 1.' },
			timeoutSec: { description: 'Max wait time for trigger (seconds). Default: 30.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const channel = typeof args.channel === 'number' ? args.channel : 0;
			const edge = ['rising', 'falling', 'either'].includes(String(args.edge))
				? (args.edge as 'rising' | 'falling' | 'either')
				: 'rising';
			const durationSec = typeof args.durationSec === 'number' ? args.durationSec : 1;

			let captureChannels: ILogicChannel[];
			if (Array.isArray(args.captureChannels)) {
				captureChannels = (args.captureChannels as Array<Record<string, unknown>>).map(c => ({
					id: Number(c['id'] ?? 0),
					label: String(c['label'] ?? `CH${c['id'] ?? 0}`),
					threshold: Number(c['threshold'] ?? 1.65),
					pullup: Boolean(c['pullup'] ?? false),
				}));
			} else {
				captureChannels = [{ id: channel, label: `CH${channel}`, threshold: 1.65, pullup: false }];
			}

			const trigger = { channel, edge };
			const capture = await la.armTrigger(trigger, { channels: captureChannels, durationSec });

			return [
				`Trigger fired and capture complete: ${capture.captureId}`,
				`Trigger: ${edge} edge on CH${channel}`,
				`Captured ${capture.durationSec}s at ${(capture.sampleRate / 1e6).toFixed(1)} MHz`,
				``,
				`Decode the captured signal:`,
				`  fw_la_decode({ captureId: "${capture.captureId}", protocol: "uart", baudRate: 115200 })`,
			].join('\n');
		},
	};
}


function _fwLaExport(la: ILogicAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_la_export',
		description: 'Export decoded frames from a capture as CSV. Returns the file path where the CSV was saved under .inverse/captures/.',
		params: {
			captureId: { description: 'Capture ID to export.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const captureId = String(args.captureId ?? '');
			if (!captureId) { return 'Provide captureId from fw_la_capture.'; }

			const capture = la.getCapture(captureId);
			if (!capture) {
				return `Capture ${captureId} not found in memory. Re-run fw_la_capture to regenerate.`;
			}

			if (capture.frames.length === 0) {
				return `No decoded frames in capture ${captureId}. Run fw_la_decode first.`;
			}

			// Format frames as CSV lines
			const rows: string[] = ['timestamp_s,protocol,address_hex,data_hex,data_ascii,direction,error'];
			for (const frame of capture.frames) {
				const addr = frame.address !== undefined ? `0x${frame.address.toString(16).toUpperCase().padStart(2, '0')}` : '';
				const csv = [
					frame.timestamp.toFixed(9),
					frame.protocol,
					addr,
					frame.dataHex,
					`"${frame.dataAscii.replace(/"/g, '""')}"`,
					frame.direction ?? '',
					frame.error ?? '',
				].join(',');
				rows.push(csv);
			}

			const csvContent = rows.join('\n');
			const path = `.inverse/captures/${captureId}/decoded.csv`;

			// Write via Node.js fs (available in VS Code extension host)
			const fs = (globalThis as Record<string, unknown>)['require']
				? (((globalThis as Record<string, unknown>)['require'] as (m: string) => unknown)('fs') as typeof import('fs'))
				: null;

			if (fs) {
				const dir = `.inverse/captures/${captureId}`;
				if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
				fs.writeFileSync(path, csvContent, 'utf8');
			}

			return [
				`Exported ${capture.frames.length} frames to: ${path}`,
				`Format: timestamp_s, protocol, address_hex, data_hex, data_ascii, direction, error`,
				``,
				`Preview (first 5 rows):`,
				rows.slice(0, 6).join('\n'),
			].join('\n');
		},
	};
}
