/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ModernisationSessionService
 *
 * Single source of truth for the active modernisation session.
 * Tracks which folders are connected, the current workflow stage,
 * and the file pair selected for compliance analysis.
 *
 * Consumed by:
 *  - ModernisationPart (Compliance Center aux window)
 *  - ModernisationWorkflowViewPane (sidebar panel)
 *  - ModernisationStatusContribution (statusbar item)
 *  - neuralInverseModernisation.contribution (command handler)
 */

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IModernisationProjectFile, MODERNISATION_INVERSE_FILENAME } from '../common/modernisationTypes.js';
import { IMetricsService } from '../../void/common/metricsService.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModernisationStage = 'discovery' | 'planning' | 'migration' | 'validation' | 'cutover';

export const STAGE_LABELS: Record<ModernisationStage, string> = {
	discovery:  '1. Discovery',
	planning:   '2. Planning',
	migration:  '3. Migration',
	validation: '4. Validation',
	cutover:    '5. Cutover',
};

export const STAGES: ModernisationStage[] = ['discovery', 'planning', 'migration', 'validation', 'cutover'];

/**
 * Migration pattern — open string, not a fixed enum.
 * Preset suggestions are in MIGRATION_PATTERN_PRESETS (data-driven).
 * Users can type any free-form pattern name for a custom migration.
 */
export type MigrationPattern = string;

/**
 * Topology of a migration pattern — defines how many source and target
 * projects are involved.
 *
 *  'one'      — exactly one project on this side
 *  'many'     — user defines N ≥ 1 projects on this side
 *  'flexible' — 1 or more; user decides
 */
export interface IPatternTopology {
	sourceCount: 'one' | 'many' | 'flexible';
	targetCount: 'one' | 'many' | 'flexible';
	/** Default label for a source project in this topology */
	sourceLabel: string;
	/** Default label for a target project in this topology */
	targetLabel: string;
}

export interface IMigrationPatternPreset {
	id: string;
	label: string;
	description: string;
	category: string;
	topology: IPatternTopology;
}

/**
 * A single project within a session — either a source (legacy/input)
 * or a target (modern/output).
 */
export interface IProjectTarget {
	/** Stable id, generated once when the project is added */
	id: string;
	role: 'source' | 'target';
	/** User-defined label, e.g. "Legacy Monolith", "PaymentService" */
	label: string;
	folderUri: string;
}

// Topology shorthands
const T_ONE_ONE:   IPatternTopology = { sourceCount: 'one',      targetCount: 'one',      sourceLabel: 'Source Project',  targetLabel: 'Target Project' };
const T_ONE_MANY:  IPatternTopology = { sourceCount: 'one',      targetCount: 'many',     sourceLabel: 'Source Project',  targetLabel: 'Target Service' };
const T_MANY_ONE:  IPatternTopology = { sourceCount: 'many',     targetCount: 'one',      sourceLabel: 'Source Service',  targetLabel: 'Target Project' };
const T_MANY_MANY: IPatternTopology = { sourceCount: 'many',     targetCount: 'many',     sourceLabel: 'Source Service',  targetLabel: 'Target Service' };
const T_FLEX:      IPatternTopology = { sourceCount: 'flexible', targetCount: 'flexible', sourceLabel: 'Source Project',  targetLabel: 'Target Project' };

export const MIGRATION_PATTERN_PRESETS: IMigrationPatternPreset[] = [
	// Structural decomposition
	{ id: 'monolith-to-microservices',    category: 'Structural Decomposition',    label: 'Monolith \u2192 Microservices',       description: 'Decompose a monolithic system into independently deployable, bounded services.',                                         topology: { ...T_ONE_MANY,  sourceLabel: 'Monolith',          targetLabel: 'Microservice' } },
	{ id: 'monolith-to-modular-monolith', category: 'Structural Decomposition',    label: 'Monolith \u2192 Modular Monolith',    description: 'Restructure a monolith into well-defined internal modules without full decomposition.',                               topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy Monolith',   targetLabel: 'Modular Monolith' } },
	{ id: 'monolith-to-serverless',       category: 'Structural Decomposition',    label: 'Monolith \u2192 Serverless',          description: 'Extract functions from a monolith and deploy as serverless handlers.',                                                topology: { ...T_ONE_MANY,  sourceLabel: 'Monolith',          targetLabel: 'Serverless Function' } },
	{ id: 'microservices-to-monolith',    category: 'Structural Decomposition',    label: 'Microservices \u2192 Monolith',       description: 'Consolidate over-split microservices into a cohesive monolith (reverse-decomposition).',                             topology: { ...T_MANY_ONE,  sourceLabel: 'Microservice',      targetLabel: 'Monolith' } },
	{ id: 'microservices-reorganisation', category: 'Structural Decomposition',    label: 'Microservices Re-boundary',           description: 'Redraw service boundaries without changing the overall microservices topology.',                                       topology: { ...T_MANY_MANY, sourceLabel: 'Existing Service',  targetLabel: 'New Service' } },
	// Mainframe & legacy language
	{ id: 'mainframe-to-cloud',           category: 'Mainframe & Legacy Language', label: 'Mainframe \u2192 Cloud',              description: 'Translate COBOL, PL/I, RPG, or Natural to cloud-native equivalents.',                                                topology: { ...T_ONE_ONE,   sourceLabel: 'Mainframe Program', targetLabel: 'Cloud Service' } },
	{ id: 'cobol-replatform',             category: 'Mainframe & Legacy Language', label: 'COBOL Re-platform',                   description: 'Keep COBOL source but migrate runtime, OS, or compiler (e.g., z/OS \u2192 Linux on IBM Z).',                          topology: { ...T_ONE_ONE,   sourceLabel: 'COBOL Program',     targetLabel: 'Re-platformed Program' } },
	{ id: 'cobol-to-java',                category: 'Mainframe & Legacy Language', label: 'COBOL \u2192 Java',                   description: 'Translate COBOL paragraphs and copybooks to Java classes and methods.',                                              topology: { ...T_ONE_ONE,   sourceLabel: 'COBOL Program',     targetLabel: 'Java Project' } },
	{ id: 'cobol-to-typescript',          category: 'Mainframe & Legacy Language', label: 'COBOL \u2192 TypeScript',             description: 'Translate COBOL paragraphs and copybooks to TypeScript modules.',                                                   topology: { ...T_ONE_ONE,   sourceLabel: 'COBOL Program',     targetLabel: 'TypeScript Project' } },
	{ id: 'rpg-modernisation',            category: 'Mainframe & Legacy Language', label: 'RPG Modernisation',                   description: 'Modernise RPG/RPG IV programs to free-format RPG or a modern language.',                                            topology: { ...T_ONE_ONE,   sourceLabel: 'RPG Program',       targetLabel: 'Modern Program' } },
	{ id: 'natural-migration',            category: 'Mainframe & Legacy Language', label: 'Natural Migration',                   description: 'Migrate Software AG Natural / Adabas programs to modern platforms.',                                               topology: { ...T_ONE_ONE,   sourceLabel: 'Natural Program',   targetLabel: 'Modern Project' } },
	{ id: 'pl1-migration',                category: 'Mainframe & Legacy Language', label: 'PL/I Migration',                      description: 'Migrate IBM PL/I programs to Java, C#, or another modern language.',                                               topology: { ...T_ONE_ONE,   sourceLabel: 'PL/I Program',      targetLabel: 'Modern Project' } },
	{ id: 'assembler-modernisation',      category: 'Mainframe & Legacy Language', label: 'Assembler Modernisation',             description: 'Replace mainframe or embedded assembler code with a higher-level language.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'Assembler Program', targetLabel: 'Modern Program' } },
	// Database
	{ id: 'database-modernisation',       category: 'Database',                    label: 'Database Modernisation',              description: 'Replace PL/SQL, T-SQL, or embedded SQL with a modern ORM or service layer.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy Database',   targetLabel: 'Modern Data Layer' } },
	{ id: 'stored-proc-to-service',       category: 'Database',                    label: 'Stored Procs \u2192 Service Layer',   description: 'Extract stored procedure logic into application-layer microservices.',                                              topology: { ...T_ONE_MANY,  sourceLabel: 'Legacy Database',   targetLabel: 'Service' } },
	{ id: 'oracle-to-postgres',           category: 'Database',                    label: 'Oracle \u2192 PostgreSQL',            description: 'Migrate Oracle PL/SQL schemas, procedures, and data to PostgreSQL.',                                               topology: { ...T_ONE_ONE,   sourceLabel: 'Oracle Database',   targetLabel: 'PostgreSQL Database' } },
	{ id: 'db2-migration',                category: 'Database',                    label: 'DB2 Migration',                       description: 'Migrate IBM DB2 schemas, stored procedures, and workloads.',                                                       topology: { ...T_ONE_ONE,   sourceLabel: 'DB2 Database',      targetLabel: 'Modern Database' } },
	{ id: 'sybase-migration',             category: 'Database',                    label: 'Sybase \u2192 Modern DB',             description: 'Migrate Sybase ASE schemas and T-SQL to SQL Server or PostgreSQL.',                                                topology: { ...T_ONE_ONE,   sourceLabel: 'Sybase Database',   targetLabel: 'Modern Database' } },
	// Framework & language
	{ id: 'framework-upgrade',            category: 'Framework & Language',        label: 'Framework Upgrade',                   description: 'Upgrade to a newer version of the same framework (Spring Boot, Angular, .NET, etc.).',                            topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy Project',    targetLabel: 'Upgraded Project' } },
	{ id: 'java-ee-to-jakarta',           category: 'Framework & Language',        label: 'Java EE \u2192 Jakarta EE',           description: 'Migrate Java EE applications to Jakarta EE with updated namespace and APIs.',                                      topology: { ...T_ONE_ONE,   sourceLabel: 'Java EE Project',   targetLabel: 'Jakarta EE Project' } },
	{ id: 'dotnet-framework-to-core',     category: 'Framework & Language',        label: '.NET Framework \u2192 .NET',          description: 'Port .NET Framework applications to .NET 6/8 on Linux/containers.',                                               topology: { ...T_ONE_ONE,   sourceLabel: '.NET Fx Project',   targetLabel: '.NET Project' } },
	{ id: 'angular-js-to-angular',        category: 'Framework & Language',        label: 'AngularJS \u2192 Angular',            description: 'Rewrite AngularJS (1.x) applications in Angular (2+).',                                                           topology: { ...T_ONE_ONE,   sourceLabel: 'AngularJS App',     targetLabel: 'Angular App' } },
	{ id: 'cfc-to-api',                   category: 'Framework & Language',        label: 'ColdFusion \u2192 REST API',          description: 'Replace ColdFusion components with REST APIs and a modern frontend.',                                             topology: { ...T_ONE_ONE,   sourceLabel: 'ColdFusion App',    targetLabel: 'REST API' } },
	{ id: 'struts-migration',             category: 'Framework & Language',        label: 'Struts Migration',                    description: 'Migrate Apache Struts 1/2 applications to Spring MVC or Spring Boot.',                                            topology: { ...T_ONE_ONE,   sourceLabel: 'Struts App',        targetLabel: 'Spring Boot App' } },
	{ id: 'vb6-to-dotnet',               category: 'Framework & Language',        label: 'VB6 \u2192 .NET',                     description: 'Rewrite Visual Basic 6 applications in VB.NET or C#.',                                                            topology: { ...T_ONE_ONE,   sourceLabel: 'VB6 Project',       targetLabel: '.NET Project' } },
	{ id: 'perl-modernisation',           category: 'Framework & Language',        label: 'Perl Modernisation',                  description: 'Replace legacy Perl scripts with Python, Ruby, or Go equivalents.',                                               topology: { ...T_ONE_ONE,   sourceLabel: 'Perl Scripts',      targetLabel: 'Modern Project' } },
	// Architecture style
	{ id: 'soa-to-microservices',         category: 'Architecture Style',          label: 'SOA \u2192 Microservices',            description: 'Decompose SOA / ESB-based services into lightweight, independent microservices.',                                  topology: { ...T_MANY_MANY, sourceLabel: 'SOA Service',       targetLabel: 'Microservice' } },
	{ id: 'event-driven-refactor',        category: 'Architecture Style',          label: 'Event-Driven Refactor',               description: 'Introduce event streaming (Kafka, EventBridge) to decouple synchronous call chains.',                             topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy System',     targetLabel: 'Event-Driven System' } },
	{ id: 'batch-to-streaming',           category: 'Architecture Style',          label: 'Batch \u2192 Streaming',              description: 'Replace scheduled batch jobs with real-time stream processing pipelines.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'Batch System',      targetLabel: 'Streaming System' } },
	{ id: 'api-gateway-consolidation',    category: 'Architecture Style',          label: 'API Gateway Consolidation',           description: 'Consolidate multiple legacy API facades behind a unified modern gateway.',                                        topology: { ...T_MANY_ONE,  sourceLabel: 'Legacy API',        targetLabel: 'API Gateway' } },
	{ id: 'strangler-fig',                category: 'Architecture Style',          label: 'Strangler Fig Pattern',               description: 'Incrementally replace legacy system components by routing traffic to new equivalents.',                            topology: { ...T_ONE_MANY,  sourceLabel: 'Legacy System',     targetLabel: 'New Component' } },
	{ id: 'lift-and-shift',               category: 'Architecture Style',          label: 'Lift & Shift (Rehost)',               description: 'Move the application to a new infrastructure with minimal code changes.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'On-Prem System',    targetLabel: 'Cloud System' } },
	{ id: 'replatform',                   category: 'Architecture Style',          label: 'Re-platform',                         description: 'Migrate to a new runtime or cloud platform with targeted optimisations.',                                        topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy System',     targetLabel: 'Modern Platform' } },
	// Firmware Modernisation
	{ id: 'bare-metal-to-freertos',      category: 'Firmware Modernisation',      label: 'Bare-metal \u2192 FreeRTOS',           description: 'Introduce FreeRTOS task scheduling, queues, and semaphores to replace a bare-metal super-loop.',           topology: { ...T_ONE_ONE,   sourceLabel: 'Bare-metal Firmware',  targetLabel: 'FreeRTOS Firmware' } },
	{ id: 'bare-metal-to-zephyr',        category: 'Firmware Modernisation',      label: 'Bare-metal \u2192 Zephyr RTOS',        description: 'Migrate a bare-metal or FreeRTOS firmware base to Zephyr with device tree bindings and kernel APIs.',     topology: { ...T_ONE_ONE,   sourceLabel: 'Bare-metal Firmware',  targetLabel: 'Zephyr Firmware' } },
	{ id: 'hal-abstraction',             category: 'Firmware Modernisation',      label: 'Add HAL Abstraction Layer',       description: 'Introduce a Hardware Abstraction Layer (HAL/BSP) over existing register-direct peripheral access.',       topology: { ...T_ONE_ONE,   sourceLabel: 'Register-direct Code', targetLabel: 'HAL-abstracted Code' } },
	{ id: 'c-to-cpp-embedded',           category: 'Firmware Modernisation',      label: 'Embedded C \u2192 C++ (MISRA)',        description: 'Port embedded C firmware to MISRA-compliant C++ with class-based HAL, RAII, and no dynamic allocation.', topology: { ...T_ONE_ONE,   sourceLabel: 'Embedded C Project',   targetLabel: 'Embedded C++ Project' } },
	{ id: 'mcu-platform-migration',      category: 'Firmware Modernisation',      label: 'MCU Platform Migration',          description: 'Migrate firmware from one MCU family to another (e.g. STM32 -> NXP i.MX RT, AVR -> ARM Cortex-M).',       topology: { ...T_ONE_ONE,   sourceLabel: 'Source MCU Firmware',  targetLabel: 'Target MCU Firmware' } },
	{ id: 'legacy-bsp-modernisation',    category: 'Firmware Modernisation',      label: 'Legacy BSP Modernisation',        description: 'Modernise an ageing Board Support Package: update startup code, linker scripts, and peripheral inits.',   topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy BSP',           targetLabel: 'Modern BSP' } },
	{ id: 'register-map-migration',      category: 'Firmware Modernisation',      label: 'Register Map (SVD) Migration',    description: 'Migrate raw register-manipulation code to SVD-generated CMSIS header abstractions.',                       topology: { ...T_ONE_ONE,   sourceLabel: 'Raw Register Code',    targetLabel: 'SVD/CMSIS Code' } },
	{ id: 'isr-refactor',                category: 'Firmware Modernisation',      label: 'ISR Architecture Refactor',       description: 'Refactor monolithic ISR handlers into deferred processing patterns (queues, event flags, callbacks).',   topology: { ...T_ONE_ONE,   sourceLabel: 'ISR-heavy Firmware',   targetLabel: 'Deferred-processing Firmware' } },
	{ id: 'assembly-to-embedded-c',      category: 'Firmware Modernisation',      label: 'Assembly \u2192 Embedded C',           description: 'Translate ARM or AVR assembly routines to portable embedded C using HAL APIs.',                           topology: { ...T_ONE_ONE,   sourceLabel: 'Assembly Source',      targetLabel: 'Embedded C' } },
	// Industrial & OT
	{ id: 'plc-to-ipc',                  category: 'Industrial & OT',             label: 'PLC \u2192 IPC (Industrial PC)',       description: 'Migrate PLC ladder or structured text logic to a software-defined IPC running a real-time OS.',          topology: { ...T_ONE_ONE,   sourceLabel: 'PLC Program',          targetLabel: 'IPC Application' } },
	{ id: 'ladder-to-structured-text',   category: 'Industrial & OT',             label: 'Ladder Logic \u2192 Structured Text',  description: 'Translate IEC 61131-3 Ladder Diagram rungs to equivalent Structured Text (ST) programs.',               topology: { ...T_ONE_ONE,   sourceLabel: 'Ladder Logic Program', targetLabel: 'Structured Text Program' } },
	{ id: 'modbus-to-opcua',             category: 'Industrial & OT',             label: 'Modbus \u2192 OPC-UA',                 description: 'Replace Modbus RTU/TCP polling loops with OPC-UA subscriptions and a standardised information model.', topology: { ...T_ONE_ONE,   sourceLabel: 'Modbus Client',        targetLabel: 'OPC-UA Client' } },
	{ id: 'scada-modernisation',         category: 'Industrial & OT',             label: 'SCADA/HMI Modernisation',         description: 'Migrate legacy SCADA/HMI screens and tag databases to modern platforms (Ignition, WinCC, AVEVA).',     topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy SCADA/HMI',    targetLabel: 'Modern SCADA/HMI' } },
	{ id: 'ot-it-convergence',           category: 'Industrial & OT',             label: 'OT/IT Convergence',               description: 'Bridge operational technology (OT) field data with IT cloud infrastructure via MQTT, Kafka, or REST.',  topology: { ...T_ONE_MANY,  sourceLabel: 'OT Field System',      targetLabel: 'IT/Cloud Integration' } },
	{ id: 'iec61131-harmonisation',      category: 'Industrial & OT',             label: 'IEC 61131-3 Harmonisation',       description: 'Harmonise PLC programs across multiple vendors to the IEC 61131-3 standard for portability.',            topology: { ...T_MANY_ONE,  sourceLabel: 'Vendor PLC Program',   targetLabel: 'IEC 61131-3 Program' } },
	{ id: 'can-dbc-migration',           category: 'Industrial & OT',             label: 'CAN DBC Signal Migration',        description: 'Migrate CAN bus signal definitions from legacy DBC files to new network topologies or protocols.',        topology: { ...T_ONE_ONE,   sourceLabel: 'Legacy CAN Network',   targetLabel: 'Modern CAN/CAN-FD Network' } },
	// Safety & Compliance
	{ id: 'sil-uplift',                  category: 'Safety & Compliance',         label: 'SIL Uplift (IEC 61508)',          description: 'Refactor firmware or PLC code to meet a higher Safety Integrity Level under IEC 61508.',                 topology: { ...T_ONE_ONE,   sourceLabel: 'Non-SIL Firmware',     targetLabel: 'SIL-rated Firmware' } },
	{ id: 'misra-c-remediation',         category: 'Safety & Compliance',         label: 'MISRA-C Remediation',             description: 'Systematically resolve MISRA-C:2012 mandatory and required rule violations across a C firmware codebase.', topology: { ...T_ONE_ONE, sourceLabel: 'Non-compliant C Code', targetLabel: 'MISRA-C:2012 Compliant Code' } },
	{ id: 'autosar-classic-to-adaptive', category: 'Safety & Compliance',         label: 'AUTOSAR Classic \u2192 Adaptive',      description: 'Migrate AUTOSAR Classic SWCs and RTE bindings to AUTOSAR Adaptive (ARA) executables and SOME/IP.',      topology: { ...T_ONE_ONE,   sourceLabel: 'AUTOSAR Classic App',  targetLabel: 'AUTOSAR Adaptive App' } },
	{ id: 'functional-safety-audit',     category: 'Safety & Compliance',         label: 'Functional Safety Audit',         description: 'Audit an existing firmware or PLC codebase against IEC 61508 / ISO 26262 / IEC 62443 requirements.',    topology: { ...T_ONE_ONE,   sourceLabel: 'Unaudited Firmware',   targetLabel: 'Safety-audited Firmware' } },
	{ id: 'iec62443-hardening',          category: 'Safety & Compliance',         label: 'IEC 62443 Cybersecurity',         description: 'Harden OT system firmware and network interfaces against IEC 62443 industrial cybersecurity requirements.', topology: { ...T_ONE_ONE, sourceLabel: 'Unprotected OT System', targetLabel: 'IEC 62443-hardened System' } },
	// Automotive
	{ id: 'autosar-cp-to-ap',            category: 'Automotive',                  label: 'AUTOSAR Classic \u2192 Adaptive (Full)', description: 'Full migration of AUTOSAR Classic CP SWCs and RTE to AUTOSAR Adaptive (ARA) executables with SOME/IP, ara::com, ara::diag, and ara::per.', topology: { ...T_ONE_ONE, sourceLabel: 'AUTOSAR Classic Project', targetLabel: 'AUTOSAR Adaptive Project' } },
	{ id: 'can-dbc-to-canopen',          category: 'Automotive',                  label: 'CAN DBC \u2192 CANopen / CAN-FD',      description: 'Migrate legacy fixed-frame CAN DBC signal databases to CANopen (CiA 301/DS-402) object dictionary design with CAN-FD support.', topology: { ...T_ONE_ONE, sourceLabel: 'Legacy CAN DBC Database', targetLabel: 'CANopen Network Definition' } },
	{ id: 'iso26262-asil-uplift',        category: 'Automotive',                  label: 'ISO 26262 ASIL Uplift',           description: 'Refactor automotive firmware and SWCs to meet a higher ASIL level under ISO 26262 (ASIL A through ASIL D).', topology: { ...T_ONE_ONE, sourceLabel: 'Non-ASIL Automotive Code', targetLabel: 'ISO 26262 ASIL-rated Code' } },
	// Critical Infrastructure (Energy / Oil & Gas)
	{ id: 'iec61850-to-opcua',           category: 'Critical Infrastructure',     label: 'IEC 61850 \u2192 OPC-UA (Substation)', description: 'Migrate IEC 61850 substation automation SCL models and GOOSE/SV to OPC-UA information models with IEC 62443 hardening.', topology: { ...T_ONE_ONE, sourceLabel: 'IEC 61850 Substation System', targetLabel: 'OPC-UA + IEC 62443 System' } },
	{ id: 'scada-dnp3-to-opcua',         category: 'Critical Infrastructure',     label: 'SCADA / DNP3 \u2192 OPC-UA + MQTT',   description: 'Replace DNP3/Modbus SCADA polling with OPC-UA subscriptions and MQTT SparkplugB for OT/IT convergence.', topology: { ...T_ONE_ONE, sourceLabel: 'SCADA / DNP3 RTU System', targetLabel: 'OPC-UA + MQTT Integration' } },
	{ id: 'sis-esd-modernisation',       category: 'Critical Infrastructure',     label: 'SIS / ESD System Modernisation', description: 'Modernise Safety Instrumented System (SIS) or Emergency Shutdown (ESD) PLC programs to modern IEC 61511 / IEC 62443-compliant platforms.', topology: { ...T_ONE_ONE, sourceLabel: 'Legacy SIS / ESD PLC', targetLabel: 'Modern SIS / ESD Platform' } },
	// Telecom & 5G
	{ id: 'lte-enb-to-oran',             category: 'Telecom & 5G',                label: 'LTE eNB \u2192 O-RAN Disaggregated',  description: 'Disaggregate a monolithic LTE eNB stack into O-RAN-compliant CU/DU components with F1-AP, E1-AP, and NG-AP interfaces.', topology: { ...T_ONE_MANY, sourceLabel: 'Monolithic LTE eNB', targetLabel: 'O-RAN CU/DU Component' } },
	{ id: 'ttcn3-to-pytest',             category: 'Telecom & 5G',                label: 'TTCN-3 Test Suite \u2192 PyTest / Robot Framework', description: 'Migrate 3GPP TTCN-3 protocol conformance test suites to Python-based PyTest or Robot Framework integration tests with Scapy codecs.', topology: { ...T_ONE_ONE, sourceLabel: 'TTCN-3 Test Suite', targetLabel: 'PyTest / Robot Framework Suite' } },
	{ id: 'ss7-sigtran-to-diameter',     category: 'Telecom & 5G',                label: 'SS7 / SIGTRAN \u2192 Diameter / SIP', description: 'Migrate legacy SS7 / SIGTRAN signalling stack implementations to Diameter (EPC) and SIP/IMS protocols for 4G/5G core network migration.', topology: { ...T_ONE_ONE, sourceLabel: 'SS7 / SIGTRAN Stack', targetLabel: 'Diameter / SIP Core Network' } },
	// Industrial IoT & OT
	{ id: 'ethercat-to-profinet',        category: 'Industrial IoT & OT',         label: 'EtherCAT \u2192 Profinet RT',          description: 'Migrate EtherCAT master/slave application logic to Profinet RT with equivalent process data exchange and alarm handling.', topology: { ...T_ONE_ONE, sourceLabel: 'EtherCAT Application', targetLabel: 'Profinet RT Application' } },
	{ id: 'canopen-to-ethercat',         category: 'Industrial IoT & OT',         label: 'CANopen \u2192 EtherCAT CoE',          description: 'Migrate CANopen (CiA 301) object dictionary and PDO/SDO communication to EtherCAT CoE (CANopen over EtherCAT) with CoE mailbox.', topology: { ...T_ONE_ONE, sourceLabel: 'CANopen Slave/Master', targetLabel: 'EtherCAT CoE Slave' } },
	{ id: 'ot-cloud-bridge',             category: 'Industrial IoT & OT',         label: 'OT Field \u2192 Cloud IoT Bridge',     description: 'Build an OT/IT convergence bridge from PLC/SCADA field data to cloud IoT platforms via MQTT SparkplugB.', topology: { ...T_ONE_MANY, sourceLabel: 'OT Field Device / PLC', targetLabel: 'Cloud IoT Integration' } },
	// Other
	{ id: 'custom',                       category: 'Other',                       label: 'Custom',                              description: 'Define your own migration scope, unit decomposition, and compliance rules.',                                      topology: T_FLEX },
];

/** Lookup label by pattern id — derived from MIGRATION_PATTERN_PRESETS. */
export const MIGRATION_PATTERN_LABELS: Record<string, string> =
	Object.fromEntries(MIGRATION_PATTERN_PRESETS.map(p => [p.id, p.label]));

/** Lookup description by pattern id — derived from MIGRATION_PATTERN_PRESETS. */
export const MIGRATION_PATTERN_DESCRIPTIONS: Record<string, string> =
	Object.fromEntries(MIGRATION_PATTERN_PRESETS.map(p => [p.id, p.description]));

/**
 * Optional firmware / hardware configuration attached to a modernisation session.
 * Defines the source and target MCU, RTOS, compliance frameworks, and toolchains.
 */
export interface IFirmwareModuleConfig {
	/** MCU family, e.g. "STM32F4", "nRF52", "RP2040" */
	mcuFamily?: string;
	/** Full MCU variant, e.g. "STM32F407VGT6" */
	mcuVariant?: string;
	/** Core architecture key, e.g. "cortex-m4" */
	core?: string;
	/** Explicit CPU architecture (ARM / RISC-V / AVR / PIC / Xtensa / MIPS) */
	cpuArchitecture?: string;
	/** FPU usage: "hardfp" | "softfp" | "none" */
	fpuUsage?: string;
	/** Flash size in bytes */
	flashSize?: number;
	/** RAM size in bytes */
	ramSize?: number;
	/** Clock speed in MHz */
	clockMHz?: number;
	/** RTOS in use */
	rtos?: string;
	/** Build system: "cmake" | "platformio" | "make" | "esp-idf" | ... */
	buildSystem?: string;
	/** Hardware Abstraction Layer */
	hal?: string;
	/** Compiler toolchain */
	compiler?: string;
	/** Source SVD file path (relative to source project root) */
	sourceSvdPath?: string;
	/** Linker script path (relative to source root) */
	linkerScriptPath?: string;
	/** Debug probe: "j-link" | "st-link" | "cmsis-dap" | "openocd" | "pyocd" | "custom" */
	debugProbe?: string;
	/** Bootloader: "mcuboot" | "u-boot" | "dfu" | "custom" | "none" */
	bootloader?: string;
	/** Power profile: "low-power" | "normal" | "performance" */
	powerProfile?: string;
	/** MISRA-C version for compliance: "misra-c-2012" | "misra-c-2023" | "misra-cpp-2008" */
	misraVersion?: string;
	/** Target MCU variant for the output project */
	targetMcuVariant?: string;
	/** Target RTOS */
	targetRtos?: string;
	/** Target build system */
	targetBuildSystem?: string;
	/** Target HAL */
	targetHal?: string;
	/** Target compiler toolchain */
	targetCompiler?: string;
	/** Active compliance frameworks (e.g. "iec-61508", "misra-c-2012", "iso-26262") */
	complianceFrameworks: string[];
}

export interface IModernisationSessionData {
	isActive: boolean;
	/** Stable ID shared with the Modernisation.inverse file — used to key the KB. */
	sessionId?: string;
	/** All source (legacy / input) projects in this session. */
	sources: IProjectTarget[];
	/** All target (modern / output) projects in this session. */
	targets: IProjectTarget[];
	/** File currently selected for compliance analysis on the source side. */
	activeSourceFileUri?: string;
	/** File currently selected for compliance analysis on the target side. */
	activeTargetFileUri?: string;
	currentStage: ModernisationStage;
	migrationPattern?: MigrationPattern;
	/** Whether the Stage 2 (Planning) roadmap has been approved by the user */
	planApproved?: boolean;
	/** Unix ms when the session became active — used for duration telemetry */
	sessionStartedAt?: number;
	/** Optional firmware / hardware context for the source codebase */
	firmwareConfig?: IFirmwareModuleConfig;
}

// ─── Service interface ────────────────────────────────────────────────────────

export const IModernisationSessionService = createDecorator<IModernisationSessionService>('modernisationSessionService');

export interface IModernisationSessionService {
	readonly _serviceBrand: undefined;

	/** Current session snapshot. Mutates reactively — listen to onDidChangeSession for updates. */
	readonly session: IModernisationSessionData;

	/** Fires whenever session state changes. */
	readonly onDidChangeSession: Event<IModernisationSessionData>;

	/**
	 * Create a new Modernisation Project:
	 * - Writes `Modernisation.inverse` (v2) to every project root
	 * - Starts the session
	 *
	 * @param sources  One or more source (legacy) projects
	 * @param targets  One or more target (modern) projects
	 * @param pattern  The migration architecture pattern (optional, set later via setMigrationPattern)
	 */
	createProject(
		sources: Array<{ uri: URI; label: string }>,
		targets: Array<{ uri: URI; label: string }>,
		pattern?: MigrationPattern,
	): Promise<void>;

	/**
	 * Read the `Modernisation.inverse` file from a folder and restore the session.
	 * Supports both v1 (legacy/modern pair) and v2 (sources/targets arrays).
	 * Returns false if no valid file is found.
	 */
	openExistingProject(folderUri: URI): Promise<boolean>;

	/**
	 * Start a session directly (no file creation — use createProject for new projects).
	 * Persists to workspace storage and emits onDidChangeSession.
	 */
	startSession(sources: IProjectTarget[], targets: IProjectTarget[], pattern?: MigrationPattern): void;

	/** Advance the workflow to the given stage. */
	setStage(stage: ModernisationStage): void;

	/** Set the active file pair for compliance analysis. */
	setFilePair(sourceFileUri: string | undefined, targetFileUri: string | undefined): void;

	/** Set the migration architecture pattern. */
	setMigrationPattern(pattern: MigrationPattern): void;

	/** Mark the Stage 2 plan as approved by the user — allows Stage 3 to begin. */
	approvePlan(): void;

	/**
	 * Set or update the firmware / hardware module configuration for this session.
	 * Persists across restarts alongside the rest of the session state.
	 */
	setFirmwareConfig(config: IFirmwareModuleConfig): void;

	/** End the session (clears all state). */
	endSession(): void;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const SESSION_STORAGE_KEY = 'neuralInverseModernisation.session';

// ─── Implementation ───────────────────────────────────────────────────────────

class ModernisationSessionService extends Disposable implements IModernisationSessionService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeSession = this._register(new Emitter<IModernisationSessionData>());
	readonly onDidChangeSession: Event<IModernisationSessionData> = this._onDidChangeSession.event;

	private _session: IModernisationSessionData;

	get session(): IModernisationSessionData { return this._session; }

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IMetricsService private readonly _metricsService: IMetricsService,
	) {
		super();
		this._session = this._load();
		// Initial validation / auto-detection against the current workspace
		this._reconcileWithWorkspace();

		// Re-run every time the workspace folders change (e.g. the user opens a
		// different project in the same window via File > Open Folder).  The service
		// is a singleton and is NOT re-instantiated on workspace switch, so without
		// this listener the in-memory session stays "active" for the new project.
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this._reconcileWithWorkspace();
		}));
	}

	/**
	 * Single reconciliation point — called on startup and whenever the VS Code
	 * workspace folders change (e.g. File > Open Folder replaces the workspace).
	 *
	 * Two cases:
	 *
	 *  A. Session is currently "active" in memory / storage:
	 *     Walk the stored source folders and look for Modernisation.inverse.
	 *     If found → session is legitimate, leave it alone.
	 *     If NOT found → the session belongs to a different project (stale storage
	 *     or workspace switch); clear it so the status bar stays clean.
	 *
	 *  B. Session is NOT active:
	 *     Walk the current workspace root folders and look for Modernisation.inverse.
	 *     If found → auto-restore the session so the badge lights up without the
	 *     user having to manually re-open the modernisation console.
	 */
	private async _reconcileWithWorkspace(): Promise<void> {
		// The canonical check for BOTH cases is the same:
		// look for Modernisation.inverse in the CURRENT workspace root folders.
		//
		// Case A (session active): if the current workspace has no .inverse file
		//   the session belongs to a different project — clear it immediately.
		//   (The stored source folders may legitimately have .inverse, but they
		//   are not this workspace — checking them would give a false positive.)
		//
		// Case B (session not active): if a .inverse file is found, restore it.

		const roots = this.workspaceContextService.getWorkspace().folders;

		for (const folder of roots) {
			try {
				const inverseUri = URI.joinPath(folder.uri, MODERNISATION_INVERSE_FILENAME);
				if (await this.fileService.exists(inverseUri)) {
					// This workspace contains a .inverse file — restore / keep session.
					if (!this._session.isActive) {
						await this.openExistingProject(folder.uri);
					}
					return; // valid
				}
			} catch { /* treat as not found */ }
		}

		// No .inverse file found in any current workspace root.
		// If a session was active it is stale — clear it.
		if (this._session.isActive) {
			this.endSession();
		}
	}

	async createProject(
		rawSources: Array<{ uri: URI; label: string }>,
		rawTargets: Array<{ uri: URI; label: string }>,
		pattern?: MigrationPattern,
	): Promise<void> {
		const sessionId = this._generateId();
		const now = Date.now();

		// Assign stable ids
		const sources: IProjectTarget[] = rawSources.map(s => ({
			id: this._generateId(), role: 'source' as const, label: s.label, folderUri: s.uri.toString(),
		}));
		const targets: IProjectTarget[] = rawTargets.map(t => ({
			id: this._generateId(), role: 'target' as const, label: t.label, folderUri: t.uri.toString(),
		}));

		// Write Modernisation.inverse v2 to every folder
		const writes: Promise<void>[] = [];
		for (const src of sources) {
			const file: IModernisationProjectFile = {
				neuralInverseModernisation: true, version: '2',
				role: 'source', projectLabel: src.label, projectId: src.id,
				pairedProjects: targets.map(t => ({ role: 'target' as const, label: t.label, uri: t.folderUri, id: t.id })),
				migrationPattern: pattern,
				sessionId, createdAt: now,
			};
			writes.push(this.fileService.writeFile(
				URI.joinPath(URI.parse(src.folderUri), MODERNISATION_INVERSE_FILENAME),
				VSBuffer.fromString(JSON.stringify(file, null, '\t')),
			).then(() => undefined));
		}
		for (const tgt of targets) {
			const file: IModernisationProjectFile = {
				neuralInverseModernisation: true, version: '2',
				role: 'target', projectLabel: tgt.label, projectId: tgt.id,
				pairedProjects: sources.map(s => ({ role: 'source' as const, label: s.label, uri: s.folderUri, id: s.id })),
				migrationPattern: pattern,
				sessionId, createdAt: now,
			};
			writes.push(this.fileService.writeFile(
				URI.joinPath(URI.parse(tgt.folderUri), MODERNISATION_INVERSE_FILENAME),
				VSBuffer.fromString(JSON.stringify(file, null, '\t')),
			).then(() => undefined));
		}
		await Promise.all(writes);

		this._metricsService.capture('Modernisation Project Created', {
			migration_pattern: pattern ?? 'none',
			source_count: sources.length,
			target_count: targets.length,
		});
		this.startSession(sources, targets, pattern, sessionId);
	}

	async openExistingProject(folderUri: URI): Promise<boolean> {
		const filePath = URI.joinPath(folderUri, MODERNISATION_INVERSE_FILENAME);
		try {
			const content = await this.fileService.readFile(filePath);
			const data = JSON.parse(content.value.toString()) as Partial<IModernisationProjectFile>;
			if (!data.neuralInverseModernisation) { return false; }

			let sources: IProjectTarget[] = [];
			let targets: IProjectTarget[] = [];

			if (data.version === '2' && data.role && data.projectId && data.pairedProjects) {
				// v2: reconstruct sources[] and targets[] from this file + pairedProjects
				const thisPT: IProjectTarget = {
					id: data.projectId, role: data.role,
					label: data.projectLabel ?? this._basename(folderUri.path),
					folderUri: folderUri.toString(),
				};
				const paired: IProjectTarget[] = data.pairedProjects.map(p => ({
					id: p.id, role: p.role, label: p.label, folderUri: p.uri,
				}));
				if (data.role === 'source') {
					sources = [thisPT];
					targets = paired.filter(p => p.role === 'target');
				} else {
					targets = [thisPT];
					sources = paired.filter(p => p.role === 'source');
				}
			} else if (data.pairedProject?.uri) {
				// v1 backwards compat: legacy → source, modern → target
				// pairedProject.role tells us the OTHER side; if it's 'modern', this file is legacy/source
				const isLegacy = data.pairedProject?.role === 'modern' || (!data.role && !!data.projectName);
				const thisId = this._generateId();
				const pairedId = this._generateId();
				if (isLegacy) {
					sources = [{ id: thisId, role: 'source', label: data.projectName ?? this._basename(folderUri.path), folderUri: folderUri.toString() }];
					targets = [{ id: pairedId, role: 'target', label: data.pairedProject.name ?? 'Modern Project', folderUri: data.pairedProject.uri }];
				} else {
					targets = [{ id: thisId, role: 'target', label: data.projectName ?? this._basename(folderUri.path), folderUri: folderUri.toString() }];
					sources = [{ id: pairedId, role: 'source', label: data.pairedProject.name ?? 'Legacy Project', folderUri: data.pairedProject.uri }];
				}
			} else {
				return false;
			}

			this.startSession(sources, targets, data.migrationPattern, data.sessionId);
			return true;
		} catch {
			return false;
		}
	}

	startSession(sources: IProjectTarget[], targets: IProjectTarget[], pattern?: MigrationPattern, sessionId?: string): void {
		this._mutate({
			isActive: true,
			sessionId,
			sources,
			targets,
			activeSourceFileUri: undefined,
			activeTargetFileUri: undefined,
			currentStage: 'discovery',
			migrationPattern: pattern,
			sessionStartedAt: Date.now(),
		});
	}

	private _generateId(): string {
		return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
	}

	private _basename(path: string): string {
		return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
	}

	setStage(stage: ModernisationStage): void {
		this._metricsService.capture('Modernisation Stage Advanced', {
			from_stage: this._session.currentStage,
			to_stage: stage,
		});
		this._mutate({ ...this._session, currentStage: stage });
	}

	setFilePair(sourceFileUri: string | undefined, targetFileUri: string | undefined): void {
		this._mutate({ ...this._session, activeSourceFileUri: sourceFileUri, activeTargetFileUri: targetFileUri });
	}

	setMigrationPattern(pattern: MigrationPattern): void {
		this._mutate({ ...this._session, migrationPattern: pattern });
	}

	approvePlan(): void {
		this._metricsService.capture('Modernisation Plan Approved', {
			stage: this._session.currentStage,
			migration_pattern: this._session.migrationPattern ?? 'none',
		});
		this._mutate({ ...this._session, planApproved: true });
	}

	setFirmwareConfig(config: IFirmwareModuleConfig): void {
		this._mutate({ ...this._session, firmwareConfig: config });
	}

	endSession(): void {
		this._metricsService.capture('Modernisation Session Ended', {
			final_stage: this._session.currentStage,
			migration_pattern: this._session.migrationPattern ?? 'none',
			plan_approved: this._session.planApproved ?? false,
			duration_ms: this._session.sessionStartedAt ? Date.now() - this._session.sessionStartedAt : 0,
		});
		this._mutate({ isActive: false, sources: [], targets: [], currentStage: 'discovery' });
	}

	private _mutate(next: IModernisationSessionData): void {
		this._session = next;
		this.storageService.store(SESSION_STORAGE_KEY, JSON.stringify(next), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this._onDidChangeSession.fire(next);
	}

	private _load(): IModernisationSessionData {
		const raw = this.storageService.get(SESSION_STORAGE_KEY, StorageScope.WORKSPACE);
		if (raw) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const parsed = JSON.parse(raw) as any;

				// v1 storage migration guard: if old fields are present, convert them
				if (parsed.legacyFolderUri || parsed.modernFolderUri) {
					const sources: IProjectTarget[] = parsed.legacyFolderUri
						? [{ id: this._generateId(), role: 'source', label: this._basename(parsed.legacyFolderUri), folderUri: parsed.legacyFolderUri }]
						: [];
					const targets: IProjectTarget[] = parsed.modernFolderUri
						? [{ id: this._generateId(), role: 'target', label: this._basename(parsed.modernFolderUri), folderUri: parsed.modernFolderUri }]
						: [];
					return {
						isActive: parsed.isActive ?? false,
						sources, targets,
						activeSourceFileUri: parsed.legacyFileUri,
						activeTargetFileUri: parsed.modernFileUri,
						currentStage: parsed.currentStage ?? 'discovery',
						migrationPattern: parsed.migrationPattern,
						planApproved: parsed.planApproved ?? false,
					};
				}

				// v2 storage
				return {
					isActive: parsed.isActive ?? false,
					sessionId: parsed.sessionId,
					sources: parsed.sources ?? [],
					targets: parsed.targets ?? [],
					activeSourceFileUri: parsed.activeSourceFileUri,
					activeTargetFileUri: parsed.activeTargetFileUri,
					currentStage: parsed.currentStage ?? 'discovery',
					migrationPattern: parsed.migrationPattern,
					planApproved: parsed.planApproved ?? false,
					firmwareConfig: parsed.firmwareConfig,
				};
			} catch { /* fall through to default */ }
		}
		return { isActive: false, sources: [], targets: [], currentStage: 'discovery' };
	}
}

registerSingleton(IModernisationSessionService, ModernisationSessionService, InstantiationType.Delayed);
