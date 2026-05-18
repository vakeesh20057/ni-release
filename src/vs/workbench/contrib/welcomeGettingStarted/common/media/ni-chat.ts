/*---------------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

export default () => `
<div style="padding:20px 24px; font-family:var(--vscode-font-family); color:var(--vscode-foreground); height:100%; box-sizing:border-box;">
  <h2 style="margin:0 0 8px; font-size:17px; font-weight:600;">Chat &amp; Power Mode</h2>
  <p style="margin:0 0 20px; font-size:13px; color:var(--vscode-descriptionForeground); line-height:1.5;">
    Two modes to match how you think. Chat is conversational. Power Mode is structured, tool-calling, multi-step execution.
  </p>

  <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px; display:flex; align-items:center; gap:8px;">
        💬 Chat
        <span style="font-size:11px; font-weight:400; color:var(--vscode-descriptionForeground); opacity:0.7;">⌘L / Ctrl+L</span>
      </div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Ask anything, reference files with <code>@</code>, browse past threads. Context-aware across your entire workspace.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px; display:flex; align-items:center; gap:8px;">
        ⚡ Power Mode
        <span style="font-size:11px; font-weight:400; color:var(--vscode-descriptionForeground); opacity:0.7;">⌘P / Ctrl+P</span>
      </div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Full agentic loop with tool calling — edit files, run terminals, call HTTP endpoints, query Git. Real-time tool-call rendering.
      </div>
    </div>
  </div>

  <div style="font-size:12px; color:var(--vscode-descriptionForeground);">
    Press <strong>⌘L</strong> (Mac) or <strong>Ctrl+L</strong> (Win/Linux) to open Chat, or <strong>⌘P / Ctrl+P</strong> for Power Mode.
  </div>
</div>
`;
