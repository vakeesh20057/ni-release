/*---------------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

export default () => `
<div style="padding:20px 24px; font-family:var(--vscode-font-family); color:var(--vscode-foreground); height:100%; box-sizing:border-box;">
  <h2 style="margin:0 0 8px; font-size:17px; font-weight:600;">Modernisation Engine</h2>
  <p style="margin:0 0 20px; font-size:13px; color:var(--vscode-descriptionForeground); line-height:1.5;">
    End-to-end AI-assisted migration of legacy codebases — COBOL → Java, PL/SQL → TypeScript, Angular 1 → 18, and 30+ more patterns.
  </p>

  <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">📋 5-Stage Pipeline</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        <strong>Discovery</strong> → <strong>Resolution</strong> → <strong>Fingerprint</strong> → <strong>Translation</strong> → <strong>Cutover</strong>.
        Each stage is gated — migration is locked until the plan is approved.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🏗 CPM Planning</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Critical-path scheduling with blocker detection, API compatibility gates, and compliance ordering.
        12 blocker types including ASIL decomposition breaks and security key material.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🔗 Multi-Project Topology</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Define one-to-one, one-to-many, or flexible source/target project pairings.
        Open with <strong>⌥⌘M</strong> / <strong>Ctrl+Alt+M</strong>.
      </div>
    </div>
  </div>

  <div style="font-size:12px; color:var(--vscode-descriptionForeground);">
    Press <strong>⌥⌘M</strong> (Mac) or <strong>Ctrl+Alt+M</strong> (Win/Linux) to open the Modernisation window and start a session.
  </div>
</div>
`;
