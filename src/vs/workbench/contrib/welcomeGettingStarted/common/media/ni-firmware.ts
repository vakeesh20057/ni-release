/*---------------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

export default () => `
<div style="padding:20px 24px; font-family:var(--vscode-font-family); color:var(--vscode-foreground); height:100%; box-sizing:border-box;">
  <h2 style="margin:0 0 8px; font-size:17px; font-weight:600;">Firmware &amp; Safety-Critical</h2>
  <p style="margin:0 0 20px; font-size:13px; color:var(--vscode-descriptionForeground); line-height:1.5;">
    First-class support for embedded, automotive, energy, and industrial control systems with industry-specific compliance frameworks.
  </p>

  <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🔧 Languages &amp; Toolchains</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Embedded C/C++, Assembler, AUTOSAR ARXML, CAN DBC, IEC 61131 (Structured Text), TTCN-3.
        Build system detection: Keil MDK, IAR, PlatformIO, ESP-IDF, S32 Design Studio, CoDeSys.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🛡 Safety Standards</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        ISO 26262 (ASIL-D), IEC 61508 (SIL), IEC 62443, IEC 61850, MISRA-C, 3GPP, GSMA.
        Detects ISR re-entrance, watchdog gaps, unsafe pointer arithmetic, E2E protection gaps.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">⚡ Firmware Modernisation</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Migrate legacy BSPs, AUTOSAR classic → adaptive, FreeRTOS → Zephyr, or bare-metal to RTOS.
        ASIL decomposition and E2E profile verification enforced at every stage gate.
      </div>
    </div>
  </div>

  <div style="font-size:12px; color:var(--vscode-descriptionForeground);">
    Open with <strong>⌥⌘F</strong> (Mac) or <strong>Ctrl+Alt+F</strong> (Win/Linux). Or open a firmware project folder and scanning starts automatically.
  </div>
</div>
`;
