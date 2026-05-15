/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Firmware / Sector Configuration Panel
 *
 * Rendered as a wizard step inside _renderWizard() when a firmware-category
 * migration pattern is selected. Collects IFirmwareModuleConfig from the user
 * before the project is initialised.
 *
 * Sectors shown based on selected pattern category:
 *  - Firmware Modernisation    -> FirmwareBasePanel + CompliancePanel
 *  - Automotive                -> FirmwareBasePanel + AutomotivePanel + CompliancePanel
 *  - Industrial & OT           -> FirmwareBasePanel + IndustrialOTPanel + CompliancePanel
 *  - Safety & Compliance       -> FirmwareBasePanel + SafetyPanel + CompliancePanel
 *  - Critical Infrastructure   -> CriticalInfraPanel + CompliancePanel
 *  - Telecom & 5G              -> TelecomPanel + CompliancePanel
 *  - (all others)              -> panel is not shown (returns null)
 */

import { IFirmwareModuleConfig } from '../modernisationSessionService.js';

// --- Categories that require firmware config ----------------------------------

const FIRMWARE_CATEGORIES = new Set([
	'Firmware Modernisation',
	'Automotive',
	'Industrial & OT',
	'Safety & Compliance',
	'Critical Infrastructure',
	'Telecom & 5G',
	'Industrial IoT & OT',
]);

// --- DOM helpers (no innerHTML -- Trusted Types compliant) --------------------

function $e<K extends keyof HTMLElementTagNameMap>(tag: K, css?: string): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (css) { el.style.cssText = css; }
	return el;
}

function $t<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, css?: string): HTMLElementTagNameMap[K] {
	const el = $e(tag, css);
	el.textContent = text;
	return el;
}

/** Renders a labeled <select> dropdown. */
function $sel(
	label: string,
	options: string[],
	value: string | undefined,
	onChange: (v: string) => void,
	css?: string,
): HTMLElement {
	const wrap = $e('div', css);
	wrap.appendChild($t('div', label, 'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;'));
	const sel = $e('select',
		'width:100%;font-size:11px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);' +
		'border:1px solid var(--vscode-input-border,var(--vscode-widget-border));border-radius:3px;padding:4px 6px;');
	for (const opt of options) {
		const o = $e('option');
		o.value = opt;
		o.textContent = opt === '' ? '-- select --' : opt;
		sel.appendChild(o);
	}
	sel.value = value ?? '';
	sel.addEventListener('change', () => onChange(sel.value));
	wrap.appendChild(sel);
	return wrap;
}

/** Renders a labeled text <input>. */
function $inp(
	label: string,
	placeholder: string,
	value: string | undefined,
	onChange: (v: string) => void,
	css?: string,
): HTMLElement {
	const wrap = $e('div', css);
	wrap.appendChild($t('div', label, 'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;'));
	const inp = $e('input',
		'width:100%;font-size:11px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);' +
		'border:1px solid var(--vscode-input-border,var(--vscode-widget-border));border-radius:3px;padding:4px 6px;box-sizing:border-box;');
	inp.type = 'text';
	inp.placeholder = placeholder;
	inp.value = value ?? '';
	inp.addEventListener('input', () => onChange(inp.value));
	wrap.appendChild(inp);
	return wrap;
}

/** Renders a labeled checkbox. */
function $chk(
	label: string,
	checked: boolean | undefined,
	onChange: (v: boolean) => void,
): HTMLElement {
	const wrap = $e('label',
		'display:flex;align-items:center;gap:6px;font-size:11px;' +
		'color:var(--vscode-foreground);cursor:pointer;user-select:none;');
	const box = $e('input');
	box.type = 'checkbox';
	box.checked = checked ?? false;
	box.addEventListener('change', () => onChange(box.checked));
	wrap.appendChild(box);
	wrap.appendChild($t('span', label));
	return wrap;
}

// --- Section card builder -----------------------------------------------------

function _sectionCard(title: string): { card: HTMLElement; body: HTMLElement } {
	const card = $e('div',
		'border:1px solid var(--vscode-widget-border);border-radius:6px;margin-bottom:12px;overflow:hidden;');
	const hdr = $t('div', title,
		'padding:8px 12px;background:var(--vscode-sideBarSectionHeader-background);' +
		'font-size:11px;font-weight:600;color:#e0a84e;' +
		'border-bottom:1px solid var(--vscode-widget-border);');
	card.appendChild(hdr);
	const body = $e('div',
		'padding:10px 12px;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;');
	card.appendChild(body);
	return { card, body };
}

// --- Section builders ---------------------------------------------------------

const RTOS_OPTIONS = [
	'FreeRTOS', 'Zephyr', 'ThreadX', 'RTEMS', 'embOS',
	'VxWorks', 'QNX', 'Mbed OS', 'bare-metal', '',
];

const BUILD_SYSTEM_OPTIONS = [
	'cmake', 'platformio', 'make', 'esp-idf',
	'keil-mdk', 'iar-ewb', 's32-design-studio', '',
];

function _buildFirmwareBaseSection(
	draft: Partial<IFirmwareModuleConfig>,
	onChange: (patch: Partial<IFirmwareModuleConfig>) => void,
): HTMLElement {
	const { card, body } = _sectionCard('Firmware Base Configuration');

	body.appendChild($inp('MCU Family', 'e.g. STM32F4, nRF52, RP2040',
		draft.mcuFamily, v => onChange({ mcuFamily: v })));

	body.appendChild($inp('MCU Variant', 'e.g. STM32F407VGT6',
		draft.mcuVariant, v => onChange({ mcuVariant: v })));

	body.appendChild($sel('CPU Architecture',
		['ARM Cortex-M', 'ARM Cortex-A', 'ARM Cortex-R', 'RISC-V', 'AVR', 'PIC', 'Xtensa', 'MIPS', 'x86'],
		draft.cpuArchitecture, v => onChange({ cpuArchitecture: v })));

	body.appendChild($sel('Core',
		[
			'cortex-m0', 'cortex-m0plus', 'cortex-m3', 'cortex-m4', 'cortex-m4f',
			'cortex-m7', 'cortex-m33', 'cortex-m55', 'cortex-a53', 'cortex-r5',
			'risc-v-rv32', 'risc-v-rv64', '',
		],
		draft.core, v => onChange({ core: v })));

	body.appendChild($sel('FPU Usage', ['hardfp', 'softfp', 'none', ''],
		draft.fpuUsage, v => onChange({ fpuUsage: v })));

	body.appendChild($sel('RTOS (Source)', RTOS_OPTIONS,
		draft.rtos, v => onChange({ rtos: v })));

	body.appendChild($sel('RTOS (Target)', RTOS_OPTIONS,
		draft.targetRtos, v => onChange({ targetRtos: v })));

	body.appendChild($inp('HAL (Source)', 'e.g. STM32 HAL, nRF5 SDK, ESP-IDF',
		draft.hal, v => onChange({ hal: v })));

	body.appendChild($inp('HAL (Target)', 'e.g. Zephyr device drivers',
		draft.targetHal, v => onChange({ targetHal: v })));

	body.appendChild($sel('Build System (Source)', BUILD_SYSTEM_OPTIONS,
		draft.buildSystem, v => onChange({ buildSystem: v })));

	body.appendChild($sel('Build System (Target)', BUILD_SYSTEM_OPTIONS,
		draft.targetBuildSystem, v => onChange({ targetBuildSystem: v })));

	body.appendChild($inp('Compiler (Source)', 'e.g. arm-none-eabi-gcc, clang',
		draft.compiler, v => onChange({ compiler: v })));

	body.appendChild($inp('Compiler (Target)', 'e.g. arm-none-eabi-gcc 12',
		draft.targetCompiler, v => onChange({ targetCompiler: v })));

	body.appendChild($sel('Debug Probe',
		['j-link', 'st-link', 'cmsis-dap', 'openocd', 'pyocd', 'custom', ''],
		draft.debugProbe, v => onChange({ debugProbe: v })));

	body.appendChild($sel('Bootloader',
		['mcuboot', 'u-boot', 'dfu', 'custom', 'none', ''],
		draft.bootloader, v => onChange({ bootloader: v })));

	body.appendChild($sel('Power Profile',
		['low-power', 'normal', 'performance', ''],
		draft.powerProfile, v => onChange({ powerProfile: v })));

	body.appendChild($inp('SVD File Path', 'path/to/device.svd (relative to project root)',
		draft.sourceSvdPath, v => onChange({ sourceSvdPath: v })));

	body.appendChild($inp('Linker Script', 'path/to/link.ld (relative to project root)',
		draft.linkerScriptPath, v => onChange({ linkerScriptPath: v })));

	return card;
}

function _buildAutomotiveSection(
	draft: Partial<IFirmwareModuleConfig>,
	onChange: (patch: Partial<IFirmwareModuleConfig>) => void,
): HTMLElement {
	const { card, body } = _sectionCard('Automotive Configuration');

	body.appendChild($sel('AUTOSAR Schema',
		['R22-11', 'R20-11', 'R19-11', 'Classic-4.4', 'Classic-4.3', 'Adaptive-21-11', ''],
		draft.autosarSchemaVersion, v => onChange({ autosarSchemaVersion: v })));

	body.appendChild($sel('ASIL Target',
		['QM', 'ASIL-A', 'ASIL-B', 'ASIL-C', 'ASIL-D', 'ASIL-D/D', ''],
		draft.asilTarget, v => onChange({ asilTarget: v })));

	body.appendChild($inp('ECU Source Variant', 'e.g. MPC5748G, TC397',
		draft.ecuSourceVariant, v => onChange({ ecuSourceVariant: v })));

	body.appendChild($inp('ECU Target Variant', 'e.g. S32K344, TC387',
		draft.ecuTargetVariant, v => onChange({ ecuTargetVariant: v })));

	body.appendChild($sel('Target Automotive OS',
		['AUTOSAR OS', 'QNX', 'INTEGRITY', 'Linux PREEMPT_RT', 'VxWorks', ''],
		draft.targetAutomotiveOS, v => onChange({ targetAutomotiveOS: v })));

	body.appendChild($sel('SOME/IP Mode',
		['multicast', 'unicast', 'hybrid', ''],
		draft.someIpMode, v => onChange({ someIpMode: v })));

	// CAN-FD checkbox spans a cell
	const chkWrap = $e('div', 'display:flex;align-items:center;');
	chkWrap.appendChild($chk('CAN-FD Required', draft.canFdEnabled,
		v => onChange({ canFdEnabled: v })));
	body.appendChild(chkWrap);

	body.appendChild($sel('Diagnostic Protocol',
		['UDS ISO 14229', 'OBD-II', 'KWP2000', 'XCP', ''],
		draft.diagnosticProtocol, v => onChange({ diagnosticProtocol: v })));

	return card;
}

function _buildSafetySection(
	draft: Partial<IFirmwareModuleConfig>,
	onChange: (patch: Partial<IFirmwareModuleConfig>) => void,
): HTMLElement {
	const { card, body } = _sectionCard('Safety & Compliance Configuration');

	body.appendChild($sel('MISRA Version',
		['misra-c-2012', 'misra-c-2023', 'misra-cpp-2008', 'misra-cpp-2023', ''],
		draft.misraVersion, v => onChange({ misraVersion: v })));

	body.appendChild($sel('ASIL Target',
		['QM', 'ASIL-A', 'ASIL-B', 'ASIL-C', 'ASIL-D', 'ASIL-D/D', ''],
		draft.asilTarget, v => onChange({ asilTarget: v })));

	body.appendChild($sel('SIL Target',
		['SIL 1', 'SIL 2', 'SIL 3', 'SIL 4', ''],
		draft.silTarget, v => onChange({ silTarget: v })));

	body.appendChild($sel('IEC 62443 SL',
		['SL 1', 'SL 2', 'SL 3', 'SL 4', ''],
		draft.iec62443SecurityLevel, v => onChange({ iec62443SecurityLevel: v })));

	return card;
}

function _buildCriticalInfraSection(
	draft: Partial<IFirmwareModuleConfig>,
	onChange: (patch: Partial<IFirmwareModuleConfig>) => void,
): HTMLElement {
	const { card, body } = _sectionCard('Critical Infrastructure Configuration');

	body.appendChild($sel('IEC 61850 Edition',
		['Edition 1', 'Edition 2', 'Edition 2.1', ''],
		draft.iec61850Edition, v => onChange({ iec61850Edition: v })));

	body.appendChild($sel('Communication Model',
		['GOOSE', 'SV', 'MMS', 'XMPP', 'mixed', ''],
		draft.iec61850CommunicationModel, v => onChange({ iec61850CommunicationModel: v })));

	body.appendChild($sel('Protection Relay Protocol',
		['IEC 60870-5-101', 'IEC 60870-5-104', 'DNP3', 'Modbus', ''],
		draft.protectionRelayProtocol, v => onChange({ protectionRelayProtocol: v })));

	body.appendChild($sel('SIL Target',
		['SIL 1', 'SIL 2', 'SIL 3', 'SIL 4', ''],
		draft.silTarget, v => onChange({ silTarget: v })));

	body.appendChild($sel('IEC 62443 SL',
		['SL 1', 'SL 2', 'SL 3', 'SL 4', ''],
		draft.iec62443SecurityLevel, v => onChange({ iec62443SecurityLevel: v })));

	body.appendChild($sel('Communication Redundancy',
		['HSR', 'PRP', 'RSTP', 'MRP', 'none', ''],
		draft.communicationRedundancy, v => onChange({ communicationRedundancy: v })));

	body.appendChild($sel('NERC CIP Version',
		['CIP-013-2', 'CIP-014-3', 'CIP-007-6', 'CIP-010-4', ''],
		draft.nercCipVersion, v => onChange({ nercCipVersion: v })));

	body.appendChild($inp('OPC-UA Namespace URI', 'urn:example:namespace',
		draft.opcuaNamespaceUri, v => onChange({ opcuaNamespaceUri: v })));

	body.appendChild($inp('SCL File Path', 'path/to/substation.scd',
		draft.sclFilePath, v => onChange({ sclFilePath: v })));

	return card;
}

function _buildTelecomSection(
	draft: Partial<IFirmwareModuleConfig>,
	onChange: (patch: Partial<IFirmwareModuleConfig>) => void,
): HTMLElement {
	const { card, body } = _sectionCard('Telecom & 5G Configuration');

	body.appendChild($sel('3GPP Release',
		['Rel-15', 'Rel-16', 'Rel-17', 'Rel-18', 'Rel-19', ''],
		draft.release3gpp, v => onChange({ release3gpp: v })));

	body.appendChild($sel('RAT',
		['NR', 'LTE', 'NR-U', 'NTN', 'NR-RedCap', ''],
		draft.rat, v => onChange({ rat: v })));

	body.appendChild($sel('Core Network Mode',
		['5GC (5G SA)', 'EPC (4G)', 'NSA', ''],
		draft.coreNetworkMode, v => onChange({ coreNetworkMode: v })));

	body.appendChild($sel('Network Function Type',
		['gNB', 'DU', 'CU-CP', 'CU-UP', 'AMF', 'SMF', 'UPF', 'PCF', 'UDM', 'AUSF', 'NRF', 'NSSF', 'NEF', ''],
		draft.networkFunctionType, v => onChange({ networkFunctionType: v })));

	body.appendChild($sel('O-RAN Split Option',
		['Option 2', 'Option 6', 'Option 7-2x', 'Option 8', ''],
		draft.oranSplitOption, v => onChange({ oranSplitOption: v })));

	body.appendChild($sel('Deployment Model',
		['Bare Metal', 'VM (KVM)', 'Container/K8s', 'Cloud Native (CNTT)', ''],
		draft.deploymentModel, v => onChange({ deploymentModel: v })));

	body.appendChild($sel('RIC Integration',
		['Near-RT RIC', 'Non-RT RIC', 'both', 'none', ''],
		draft.ricIntegration, v => onChange({ ricIntegration: v })));

	const chkWrap1 = $e('div', 'display:flex;align-items:center;');
	chkWrap1.appendChild($chk('Key Material Externalised (HSM/TEE)',
		draft.keyMaterialExternalised, v => onChange({ keyMaterialExternalised: v })));
	body.appendChild(chkWrap1);

	const chkWrap2 = $e('div', 'display:flex;align-items:center;');
	chkWrap2.appendChild($chk('Network Slicing',
		draft.networkSlicingEnabled, v => onChange({ networkSlicingEnabled: v })));
	body.appendChild(chkWrap2);

	return card;
}

function _buildIndustrialOTSection(
	draft: Partial<IFirmwareModuleConfig>,
	onChange: (patch: Partial<IFirmwareModuleConfig>) => void,
): HTMLElement {
	const { card, body } = _sectionCard('Industrial & OT Configuration');

	body.appendChild($inp('EtherCAT Master Stack', 'e.g. EtherLab, SOEM, TwinCAT',
		draft.ethercatMasterStack, v => onChange({ ethercatMasterStack: v })));

	body.appendChild($sel('Profinet Conformance Class',
		['CC-A', 'CC-B', 'CC-C', ''],
		draft.profinetConformanceClass, v => onChange({ profinetConformanceClass: v })));

	body.appendChild($inp('CANopen Profile', 'e.g. DS402 (motion), DS401 (I/O)',
		draft.canopenProfile, v => onChange({ canopenProfile: v })));

	body.appendChild($sel('MQTT Version',
		['MQTT 3.1.1', 'MQTT 5.0', 'SparkplugB', ''],
		draft.mqttVersion, v => onChange({ mqttVersion: v })));

	const chkWrap1 = $e('div', 'display:flex;align-items:center;');
	chkWrap1.appendChild($chk('OPC-UA PubSub',
		draft.opcuaPubSubEnabled, v => onChange({ opcuaPubSubEnabled: v })));
	body.appendChild(chkWrap1);

	const chkWrap2 = $e('div', 'display:flex;align-items:center;');
	chkWrap2.appendChild($chk('TSN Enabled',
		draft.tsnEnabled, v => onChange({ tsnEnabled: v })));
	body.appendChild(chkWrap2);

	body.appendChild($sel('Cloud IoT Platform',
		['AWS IoT Core', 'Azure IoT Hub', 'GCP IoT Core', 'custom', ''],
		draft.cloudIotPlatform, v => onChange({ cloudIotPlatform: v })));

	body.appendChild($sel('IEC 62443 Zone',
		['Zone 0', 'Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', ''],
		draft.zoneSeparationLevel, v => onChange({ zoneSeparationLevel: v })));

	const chkWrap3 = $e('div', 'display:flex;align-items:center;');
	chkWrap3.appendChild($chk('IDMZ Required',
		draft.idmzRequired, v => onChange({ idmzRequired: v })));
	body.appendChild(chkWrap3);

	return card;
}

// Compliance frameworks list: [key, display label]
const COMPLIANCE_FRAMEWORK_DEFS: Array<[string, string]> = [
	['misra-c-2012',    'MISRA-C:2012'],
	['misra-c-2023',    'MISRA-C:2023'],
	['misra-cpp-2008',  'MISRA-C++:2008'],
	['iso-26262',       'ISO 26262 (Automotive)'],
	['iec-61508',       'IEC 61508 (Functional Safety)'],
	['iec-62443',       'IEC 62443 (Industrial Cybersecurity)'],
	['iec-61850',       'IEC 61850 (Power Systems)'],
	['iec-61131',       'IEC 61131-3 (PLC)'],
	['do-178c',         'DO-178C (Avionics)'],
	['en-50128',        'EN 50128 (Railway)'],
	['nerc-cip',        'NERC CIP'],
	['3gpp-security',   '3GPP Security'],
	['financial-core',  'Financial Core'],
	['sox',             'SOX'],
	['gdpr-pii',        'GDPR / PII'],
];

function _buildComplianceSection(
	draft: Partial<IFirmwareModuleConfig>,
	onChange: (patch: Partial<IFirmwareModuleConfig>) => void,
): HTMLElement {
	const card = $e('div',
		'border:1px solid var(--vscode-widget-border);border-radius:6px;margin-bottom:12px;overflow:hidden;');
	const hdr = $t('div', 'Compliance Frameworks',
		'padding:8px 12px;background:var(--vscode-sideBarSectionHeader-background);' +
		'font-size:11px;font-weight:600;color:#e0a84e;' +
		'border-bottom:1px solid var(--vscode-widget-border);');
	card.appendChild(hdr);

	const body = $e('div',
		'padding:10px 12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 12px;');

	const currentFrameworks = draft.complianceFrameworks ?? [];

	for (const [key, displayLabel] of COMPLIANCE_FRAMEWORK_DEFS) {
		const isChecked = currentFrameworks.includes(key);
		const chkEl = $chk(displayLabel, isChecked, (checked) => {
			const existing = draft.complianceFrameworks ?? [];
			const updated = checked
				? [...existing, key]
				: existing.filter(f => f !== key);
			onChange({ complianceFrameworks: updated });
		});
		body.appendChild(chkEl);
	}

	card.appendChild(body);
	return card;
}

// --- Public API ---------------------------------------------------------------

/**
 * Returns whether the given pattern category requires the firmware config panel.
 */
export function requiresFirmwareConfig(patternCategory: string | undefined): boolean {
	if (!patternCategory) { return false; }
	return FIRMWARE_CATEGORIES.has(patternCategory);
}

/**
 * Builds and returns the firmware/sector configuration panel element, or null
 * if the selected pattern category does not require firmware configuration.
 *
 * @param patternCategory - The selected migration pattern category string.
 * @param current         - The current (possibly partial) firmware config values.
 * @param onChange        - Called with a patch whenever any field changes.
 */
export function buildFirmwareConfigPanel(
	patternCategory: string | undefined,
	current: Partial<IFirmwareModuleConfig>,
	onChange: (patch: Partial<IFirmwareModuleConfig>) => void,
): HTMLElement | null {
	if (!requiresFirmwareConfig(patternCategory)) { return null; }

	// Accumulate a local draft so each sub-section gets the latest values
	let draft: Partial<IFirmwareModuleConfig> = { ...current };

	// Each field fires onChange with just its own patch key; we merge into
	// draft so subsequent reads see up-to-date values, then forward to caller.
	function patch(p: Partial<IFirmwareModuleConfig>): void {
		draft = { ...draft, ...p };
		onChange(draft);
	}

	// Outer scrollable container
	const container = $e('div', 'overflow-y:auto;padding:0 2px;');

	// Title
	container.appendChild($t('div', 'Sector Configuration',
		'font-size:12px;font-weight:600;color:#e0a84e;margin-bottom:4px;'));

	// Subtitle
	const subtitle = _categorySubtitle(patternCategory!);
	if (subtitle) {
		container.appendChild($t('div', subtitle,
			'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:10px;'));
	}

	// Determine which base sections to show
	const isFirmwareBase = (
		patternCategory === 'Firmware Modernisation' ||
		patternCategory === 'Automotive' ||
		patternCategory === 'Industrial & OT' ||
		patternCategory === 'Industrial IoT & OT' ||
		patternCategory === 'Safety & Compliance'
	);

	if (isFirmwareBase) {
		container.appendChild(_buildFirmwareBaseSection(draft, patch));
	}

	// Sector-specific sections
	switch (patternCategory) {
		case 'Automotive':
			container.appendChild(_buildAutomotiveSection(draft, patch));
			break;
		case 'Industrial & OT':
		case 'Industrial IoT & OT':
			container.appendChild(_buildIndustrialOTSection(draft, patch));
			break;
		case 'Safety & Compliance':
			container.appendChild(_buildSafetySection(draft, patch));
			break;
		case 'Critical Infrastructure':
			container.appendChild(_buildCriticalInfraSection(draft, patch));
			break;
		case 'Telecom & 5G':
			container.appendChild(_buildTelecomSection(draft, patch));
			break;
		// 'Firmware Modernisation' only has base + compliance; no extra section
		default:
			break;
	}

	// Compliance frameworks always shown
	container.appendChild(_buildComplianceSection(draft, patch));

	return container;
}

// --- Internal helpers ---------------------------------------------------------

function _categorySubtitle(patternCategory: string): string {
	switch (patternCategory) {
		case 'Firmware Modernisation':
			return 'Configure MCU, RTOS, toolchain and compliance targets for your firmware migration.';
		case 'Automotive':
			return 'Configure AUTOSAR schema, ASIL targets, ECU variants and automotive OS for your migration.';
		case 'Industrial & OT':
		case 'Industrial IoT & OT':
			return 'Configure industrial protocols, OT security zones and IIoT platform targets.';
		case 'Safety & Compliance':
			return 'Configure MISRA version, ASIL/SIL integrity levels and cybersecurity targets.';
		case 'Critical Infrastructure':
			return 'Configure IEC 61850 edition, protection relay protocols, NERC CIP and redundancy model.';
		case 'Telecom & 5G':
			return 'Configure 3GPP release, RAT, network function type and O-RAN split option.';
		default:
			return '';
	}
}
