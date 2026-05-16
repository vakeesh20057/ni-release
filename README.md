# NeuralInverse Community Edition

<div align="center">
	<img
		src="./src/vs/workbench/browser/parts/editor/media/neuralinverse_logo.png"
		alt="NeuralInverse"
		width="300"
		height="300"
	/>
</div>

**Code Modern. Code Legacy. Code Firmware.**

NeuralInverse CE is a free, open-source AI-native IDE built for the work most AI tools ignore - modernizing legacy systems, developing firmware, and migrating regulated codebases. Bring your own LLM, no cloud lock-in.

- 🌐 [Website](https://neuralinverse.com)
- 📧 [Contact](mailto:github@neuralinverse.com)
- 🏢 [Enterprise Edition](https://neuralinverse.com) - compliance, GRC, and legacy modernization for regulated industries
- [![Sponsor NeuralInverse](https://img.shields.io/badge/Sponsor-NeuralInverse-ea4aaa?logo=github-sponsors&logoColor=white)](https://github.com/sponsors/NeuralInverse)


## Install

**macOS / Linux**
```bash
curl -fsSL neuralinverse.com/sh | bash
```

**Windows** (PowerShell)
```powershell
irm neuralinverse.com/win | iex
```


## Features

### AI Chat & Agentic Coding
- Inline and sidebar chat with full codebase context
- **Power Mode**: autonomous multi-step agent that plans, edits, runs commands, and iterates without hand-holding
- **Bring Your Own LLM**: direct integration with Claude, GPT-4, Gemini, Ollama, Bedrock, and more - your API keys stay local, no proxy

### Firmware & Embedded Development
Purpose-built for embedded engineers - not just syntax highlighting:
- **MCU database**: 357 MCU variants across 11 manufacturers (STM32, NXP, ESP32, Nordic, Renesas, TI, Infineon, RP2040, AURIX, and more) with full specs, memory maps, and peripheral lists
- **SVD auto-load**: fetches CMSIS-SVD register maps on demand, parses peripheral trees with bit-field detail, handles `derivedFrom` inheritance
- **Datasheet intelligence**: drop in a PDF and the agent extracts register maps, timing constraints, errata, and pinouts - 3-tier pipeline with LLM reclassification, content-hash caching (zero re-processing on re-open), and page-level citations
- **22 `fw_*` agent tools**: register map queries, peripheral config, bit-field lookup, errata checks, timing constraints, build + flash, serial monitor, MISRA/CERT-C checks, GDB debug (breakpoints, step, memory read/write), binary size analysis, code generation for peripheral init / ISR / DMA / clock config
- **Platform knowledge packs**: STM32, ESP32, nRF (Zephyr), RP2040 - clock trees, DMA patterns, ISR constraints, toolchain quirks injected into every agent session
- **Build system support**: PlatformIO, CMake, ESP-IDF, Make, Zephyr, Arduino, Mbed, STM32CubeIDE - build and flash directly from the IDE
- **Serial monitor**: Web Serial API, 10,000-line ring buffer, baud auto-detection, debug probe auto-detection (ST-Link, J-Link, CMSIS-DAP, FTDI, CH340, and more)
- **Compliance-aware**: MISRA C:2012, CERT C, IEC 62304, ISO 26262 rules injected into the agent context so generated code respects safety constraints

### Legacy Modernization
A full 5-stage migration platform built into the IDE. Open it with `Cmd+Alt+M`.

**Stage 1 - Discovery**
Scans source trees across 30+ languages and build systems - COBOL, PL/SQL, RPG, Natural, FORTRAN, Assembler, AUTOSAR ARXML, CAN DBC, IEC 61131-3, TTCN-3, and all mainstream languages. Extracts:
- Dependency graphs, cyclomatic complexity, tech debt categories (17 generic + 14 firmware/industrial)
- Regulated data patterns: PCI-DSS, GDPR, HIPAA, SOX, financial-core, tax-compliance, ISO 26262, IEC 61850 GOOSE, 3GPP key material, CAN signal IDs
- GRC snapshot: violation counts by domain and severity, blocking violations, top rule violations
- Market-vertical detection: automotive (AUTOSAR/MISRA), safety (IEC 61508/61511), telecom (3GPP/GSMA), energy (IEC 61850/DNP3), industrial OT (IEC 62443), embedded MCU

**Stage 2 - Planning**
CPM critical path scheduling across 7 phases (foundation -> schema -> core-logic -> API layer -> integration -> compliance -> cutover):
- 12+ blocker types including AUTOSAR RTE dependency, E2E protection gap, ASIL decomposition break, GOOSE protection relay, SIS/SIL downgrade
- Market-vertical compliance gates: automotive ASIL-D formal verification, energy GOOSE path isolation, telecom 3GPP key externalisation, IIoT/OT IEC 62443 zone/conduit isolation
- Effort estimation with safety-critical language surcharges (embedded-C, AUTOSAR, assembler, IEC 61131)
- Stage 3 locked behind plan approval gate

**Stage 3 - Source Resolution**
Prepares each migration unit for translation by inlining dependencies:
- COBOL copybook inliner with cycle detection, CALL graph resolver
- PL/SQL %TYPE/%ROWTYPE inliner, Java @EJB/@Autowired context injection
- RPG /COPY+/INCLUDE expansion, Natural USING DA/CALLNAT resolution
- Generic import inliner for TypeScript, Python, Go, Rust, C#, Kotlin, Scala and more
- Leaf-node-first scheduling with risk priority and concurrency control

**Stage 4 - Translation**
Language-pair profiles with deep idiom mappings:
- 36 profiles including: COBOL->Java (32 idioms), PL/SQL->TypeScript, RPG->Java, Natural->Java, FORTRAN->Python, Angular 1->18, Vue 2->3
- 25 firmware profiles: bare-metal C->FreeRTOS, bare-metal C->Zephyr, AUTOSAR CP->AP, CAN DBC->CANopen, IEC 61850->OPC-UA, O-RAN C->Go, EtherCAT->EtherCAT NG, TTCN-3->pytest, and more
- 6-priority context budget (source, type/naming, interfaces, rule patterns, rules/glossary, annotations)
- Verification checks: non-empty, no placeholders, no truncation, balanced braces, length sanity
- Decision tracking: every IRaisedDecision (naming, type, rule interpretation) stored and reviewable

**Knowledge Base**
Persistent store surviving IDE restarts - every translation decision, type mapping, glossary term, annotation, compliance gate result, checkpoint, and audit log entry. Importable/exportable.

**Stage 5 - Cutover**
- 8-point readiness gate (4 blocking, 2 warning, 2 info)
- Audit bundle export with FNV-1a chain integrity hash and verifiable bundle integrity
- Committed file writing to target tree via VS Code file service

**Autonomy Engine**
Optional autonomous execution: auto-approval policies, concurrent sub-task scheduling, batch progress events, configurable iteration limits and command blocklists via `.neuralinverseagent` config.

### Multi-model
Switch models per task - use a fast model for chat, a powerful one for agentic runs.


## What is not in CE

The following features are available in [NeuralInverse Enterprise](https://neuralinverse.com):

- neuralInverseChecks - real-time GRC and compliance enforcement (HIPAA, SOC2, FDA 21 CFR Part 11, ISO 26262, etc.)
- Checks Agent - AI agent with programmatic access to violations, rule explanations, and compliance reporting
- NeuralInverse auth and team collaboration features


## Credits

NeuralInverse CE is built on top of [VS Code](https://github.com/microsoft/vscode) by Microsoft. We are grateful to the VS Code team and all upstream contributors.


## Architecture

NeuralInverse CE is built on [VS Code](https://github.com/microsoft/vscode).

Key modules:
- `src/vs/workbench/contrib/void/` - AI agent and chat infrastructure
- `src/vs/workbench/contrib/powerMode/` - Power Mode agentic workflows
- `src/vs/workbench/contrib/neuralInverseModernisation/` - Legacy code modernization platform
- `src/vs/workbench/contrib/neuralInverseFirmware/` - Firmware datasheet knowledge base


## Building from source

```bash
npm install
npm run compile
```

See [HOW_TO_CONTRIBUTE.md](./HOW_TO_CONTRIBUTE.md) for full setup instructions including platform prerequisites and developer mode.


## License

Copyright 2026 Neural Inverse Inc. Licensed under the Apache License 2.0. See [License.txt](./License.txt) for details.


## Support

- Email: github@neuralinverse.com
- Website: https://neuralinverse.com
