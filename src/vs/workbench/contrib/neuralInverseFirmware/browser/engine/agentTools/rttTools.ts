/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IRTTService } from '../serial/rttService.js';
import { IITMService } from '../serial/itmService.js';


export function buildRTTTools(
	session: IFirmwareSessionService,
	rtt: IRTTService,
	itm: IITMService,
): IVoidInternalTool[] {
	return [
		_fwRttStart(session, rtt),
		_fwRttRead(rtt),
		_fwRttWrite(rtt),
		_fwITMStart(session, itm),
		_fwITMRead(itm),
		_fwSWOProfile(itm),
	];
}


function _fwRttStart(session: IFirmwareSessionService, rtt: IRTTService): IVoidInternalTool {
	return {
		name: 'fw_rtt_start',
		description: 'Start SEGGER RTT session via J-Link. RTT provides zero-overhead printf-style logging over SWD — no UART peripheral needed. Firmware must include SEGGER_RTT.c and call RTT_printf(0, "...) or SEGGER_RTT_WriteString(0, "...").',
		params: {
			targetDevice: { description: 'Target device name for J-Link (e.g. "STM32F407VG", "nRF52840_xxAA", "RP2040"). Auto-detected from session if omitted.' },
			interface: { description: 'Debug interface: "swd" (default) or "jtag".' },
			speedKHz: { description: 'SWD/JTAG speed in kHz. Default: 4000.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const targetDevice = String(args.targetDevice ?? s.mcuConfig?.variant ?? s.mcuConfig?.family ?? 'auto');
			const iface = args.interface === 'jtag' ? 'jtag' : 'swd';
			const speedKHz = typeof args.speedKHz === 'number' ? args.speedKHz : 4000;

			await rtt.startRTT(targetDevice, iface, speedKHz);
			const status = rtt.getStatus();

			return [
				`RTT connected: ${status.targetDevice} via ${status.interface?.toUpperCase()}`,
				`Speed: ${status.speedKHz} kHz`,
				`Channels: ${status.channels?.length ?? 'detecting...'}`,
				``,
				`Up channels (MCU -> host):`,
				...(status.channels?.filter(c => c.direction === 'up').map(c =>
					`  Ch${c.index}: ${c.name} (${c.bufferSize} bytes)`,
				) ?? []),
				``,
				`Down channels (host -> MCU):`,
				...(status.channels?.filter(c => c.direction === 'down').map(c =>
					`  Ch${c.index}: ${c.name} (${c.bufferSize} bytes)`,
				) ?? []),
				``,
				`Read output: fw_rtt_read({ channel: 0 })`,
				`Send command: fw_rtt_write({ channel: 0, data: "command\\n" })`,
				``,
				`Required in firmware: include SEGGER_RTT.c, call SEGGER_RTT_printf(0, "msg")`,
			].join('\n');
		},
	};
}


function _fwRttRead(rtt: IRTTService): IVoidInternalTool {
	return {
		name: 'fw_rtt_read',
		description: 'Read buffered output from an RTT up-channel (MCU to host). Channel 0 is the default terminal (printf output). Returns all lines received since last read.',
		params: {
			channel: { description: 'RTT channel number (0-31). Default: 0 (printf terminal).' },
			lines: { description: 'Number of recent lines to return. Default: all buffered.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const channel = typeof args.channel === 'number' ? args.channel : 0;
			const maxLines = typeof args.lines === 'number' ? args.lines : undefined;

			const allLines = await rtt.readChannel(channel);

			if (allLines.length === 0) {
				return [
					`RTT channel ${channel}: no data received.`,
					``,
					`Check:`,
					`  1. RTT session running: fw_rtt_start`,
					`  2. Firmware calls SEGGER_RTT_printf(${channel}, "...") or RTT_printf`,
					`  3. SEGGER_RTT_Init() called before any RTT output`,
					`  4. _SEGGER_RTT buffer not overwritten (increase buffer size in RTT config)`,
				].join('\n');
			}

			const display = maxLines ? allLines.slice(-maxLines) : allLines;
			const lines = [
				`RTT Channel ${channel} — ${display.length} line(s)${allLines.length > display.length ? ` (showing last ${maxLines})` : ''}:`,
				`${'─'.repeat(60)}`,
				...display,
			];

			return lines.join('\n');
		},
	};
}


function _fwRttWrite(rtt: IRTTService): IVoidInternalTool {
	return {
		name: 'fw_rtt_write',
		description: 'Write data to an RTT down-channel (host to MCU). The firmware must be reading from the RTT down-channel buffer. Channel 0 is the default terminal input.',
		params: {
			channel: { description: 'RTT channel number (0-31). Default: 0.' },
			data: { description: 'Data string to send to MCU. Use \\n for newline.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const channel = typeof args.channel === 'number' ? args.channel : 0;
			const data = String(args.data ?? '');

			if (!data) { return 'Provide data string to send.'; }

			await rtt.writeChannel(channel, data.replace(/\\n/g, '\n'));

			return [
				`Sent to RTT channel ${channel}: "${data.substring(0, 80)}${data.length > 80 ? '...' : ''}"`,
				`Length: ${data.length} bytes`,
				``,
				`Read MCU response: fw_rtt_read({ channel: ${channel} })`,
			].join('\n');
		},
	};
}


function _fwITMStart(session: IFirmwareSessionService, itm: IITMService): IVoidInternalTool {
	return {
		name: 'fw_itm_start',
		description: 'Enable ITM/SWO tracing on Cortex-M3/M4/M7/M33 targets. ITM provides printf-style logging over the SWD SWO pin without using a UART. Add ITM_SendChar(0, ch) or use printf via __write() redirect in firmware. Requires OpenOCD or J-Link SWO viewer.',
		params: {
			cpuFreqMHz: { description: 'CPU frequency in MHz. Required for SWO baud calculation.' },
			swoFreqMHz: { description: 'SWO bit rate in MHz. Default: cpuFreq / 8 (e.g. 21 for 168 MHz). Must be integer divisor of CPU freq.' },
			enableDWT: { description: 'Enable DWT cycle counter for timing. Default: true.' },
			enableExceptions: { description: 'Enable exception trace (interrupt entry/exit). Default: true.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const cpuFreqMHz = typeof args.cpuFreqMHz === 'number' ? args.cpuFreqMHz : (s.mcuConfig?.clockMHz ?? 168);
			const swoFreqMHz = typeof args.swoFreqMHz === 'number' ? args.swoFreqMHz : Math.floor(cpuFreqMHz / 8);

			await itm.startITM({
				cpuFreqHz: cpuFreqMHz * 1000000,
				swoFreqHz: swoFreqMHz * 1000000,
				enableDWT: args.enableDWT !== false,
				enableExceptionTrace: args.enableExceptions !== false,
				enablePCSampling: false,
				stimulusMask: 0xFFFFFFFF,
			});

			return [
				`ITM/SWO tracing active`,
				`CPU frequency: ${cpuFreqMHz} MHz`,
				`SWO bit rate:  ${swoFreqMHz} MHz (divisor: ${Math.floor(cpuFreqMHz / swoFreqMHz)})`,
				`DWT cycle counter: enabled`,
				`Exception trace: enabled`,
				``,
				`Required in firmware:`,
				`  // CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;`,
				`  // ITM->LAR = 0xC5ACCE55; // unlock ITM`,
				`  // ITM->TER = 0x1; // enable port 0`,
				`  // ITM->TCR = 0x00010005; // enable ITM, sync, ID=1`,
				`  // printf redirected via ITM_SendChar(0, ch)`,
				``,
				`Read output: fw_itm_read`,
				`Profile CPU: fw_swo_profile (requires enablePCSampling=true)`,
			].join('\n');
		},
	};
}


function _fwITMRead(itm: IITMService): IVoidInternalTool {
	return {
		name: 'fw_itm_read',
		description: 'Read decoded ITM output. Shows printf text from port 0, exception trace, and DWT counter values. Returns formatted output grouped by frame type.',
		params: {
			port: { description: 'ITM stimulus port (0-31). Default: 0 (printf). Use "all" for all ports.' },
			lines: { description: 'Number of recent lines to show. Default: 50.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const status = itm.getStatus();

			if (!status.active) {
				return [
					`ITM not active. Start with fw_itm_start({ cpuFreqMHz: ${168} })`,
					``,
					`Requirements:`,
					`  - Cortex-M3/M4/M7/M33 target (M0/M0+ do not have ITM)`,
					`  - SWO pin connected to debug probe`,
					`  - OpenOCD or J-Link SWO viewer available`,
				].join('\n');
			}

			const port = args.port === 'all' ? undefined : (typeof args.port === 'number' ? args.port : 0);
			const maxLines = typeof args.lines === 'number' ? args.lines : 50;

			const textOutput = itm.getTextOutput();
			const exceptions = itm.getExceptionTimeline();

			const lines: string[] = [
				`ITM Output — ${status.framesReceived} frames received`,
				`${'─'.repeat(60)}`,
			];

			// Port 0 text output
			if (port === undefined || port === 0) {
				const textLines = textOutput.split('\n').filter(Boolean);
				const display = textLines.slice(-maxLines);
				if (display.length > 0) {
					lines.push(`Port 0 (printf):`);
					lines.push(...display.map(l => `  ${l}`));
					lines.push('');
				}
			}

			// Exception timeline
			if ((port === undefined || port === -1) && exceptions.length > 0) {
				lines.push(`Exception trace (last ${Math.min(20, exceptions.length)}):`);
				for (const exc of exceptions.slice(-20)) {
					lines.push(`  IRQ${exc.exceptionNumber ?? '?'} ${exc.exceptionAction ?? 'entry'} @ ${new Date(exc.timestamp).toISOString().slice(11, 23)}`);
				}
				lines.push('');
			}

			if (lines.length <= 3) {
				lines.push('No ITM data received yet. Check SWO pin connection and firmware ITM setup.');
			}

			return lines.join('\n');
		},
	};
}


function _fwSWOProfile(itm: IITMService): IVoidInternalTool {
	return {
		name: 'fw_swo_profile',
		description: 'Show CPU hot-path profiling results from DWT PC sampling. Requires ITM started with enablePCSampling=true. Returns the most frequently sampled program counter addresses (hot functions).',
		params: {
			topN: { description: 'Number of hottest addresses to show. Default: 20.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const topN = typeof args.topN === 'number' ? args.topN : 20;
			const pcSamples = itm.getPCSamples();

			if (pcSamples.size === 0) {
				return [
					`No PC samples collected.`,
					`Enable PC sampling: fw_itm_start({ cpuFreqMHz: 168, enablePCSampling: true })`,
					`Note: PC sampling uses one DWT comparator and increases SWO traffic.`,
				].join('\n');
			}

			const sorted = Array.from(pcSamples.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, topN);

			const total = Array.from(pcSamples.values()).reduce((a, b) => a + b, 0);

			const lines = [
				`CPU Profile — ${total} total PC samples`,
				`${'─'.repeat(50)}`,
				`Address         Samples   % CPU`,
				`${'─'.repeat(50)}`,
			];

			for (const [pc, count] of sorted) {
				const pct = ((count / total) * 100).toFixed(1);
				const addr = `0x${pc.toString(16).toUpperCase().padStart(8, '0')}`;
				lines.push(`${addr}    ${String(count).padStart(7)}   ${pct.padStart(5)}%`);
			}

			lines.push(`${'─'.repeat(50)}`);
			lines.push(`Use addr2line or GDB "info symbol 0xADDR" to resolve addresses to function names.`);
			lines.push(`Example: arm-none-eabi-addr2line -e firmware.elf 0x${sorted[0]?.[0].toString(16).toUpperCase().padStart(8, '0') ?? '0'}`);

			return lines.join('\n');
		},
	};
}
