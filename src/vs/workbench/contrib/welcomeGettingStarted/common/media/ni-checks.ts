/*---------------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

export default () => `
<div style="padding:20px 24px; font-family:var(--vscode-font-family); color:var(--vscode-foreground); height:100%; box-sizing:border-box;">
  <h2 style="margin:0 0 8px; font-size:17px; font-weight:600;">GRC Checks &amp; Compliance</h2>
  <p style="margin:0 0 20px; font-size:13px; color:var(--vscode-descriptionForeground); line-height:1.5;">
    Real-time compliance checking against your loaded frameworks. Violations are detected as you write code — no separate CI step needed.
  </p>

  <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🔴 Blocking Violations</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Hard stops gating code merge — ASIL-D safety violations, unsafe pointer arithmetic, ISR re-entrance, missing E2E protection.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">⊗ Checks Agent</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Ask about any violation in natural language. 10 built-in GRC tools:
        <code>get_violations</code>, <code>explain_violation</code>, <code>draft_rule</code>,
        <code>run_workspace_scan</code>, <code>get_impact_chain</code>, and more.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">📐 Nano Agents</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        LSP, AST, call hierarchy, and metrics analysis run locally — no LLM calls for static checks.
        LLM is used only for reasoning about complex rule interpretations.
      </div>
    </div>
  </div>

  <div style="font-size:12px; color:var(--vscode-descriptionForeground);">
    The Checks panel runs automatically when you open a project. Click any violation to ask the Checks Agent for a fix.
  </div>
</div>
`;
