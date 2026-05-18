/*---------------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

export default () => `
<div style="padding:20px 24px; font-family:var(--vscode-font-family); color:var(--vscode-foreground); height:100%; box-sizing:border-box;">
  <h2 style="margin:0 0 8px; font-size:17px; font-weight:600;">Agentic Mode &amp; Sub-Agents</h2>
  <p style="margin:0 0 20px; font-size:13px; color:var(--vscode-descriptionForeground); line-height:1.5;">
    Orchestrate concurrent agents across your project. Each sub-agent gets a scoped role, its own thread, and a whitelisted toolset.
  </p>

  <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🗂 Agent Manager</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Central hub for all running agents. View chat history, tool calls, and status in real time.
        Open with <strong>⌥⌘A</strong> / <strong>Ctrl+Alt+A</strong>.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🔀 Sub-Agent Roles</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        <strong>Explorer</strong> (read-only analysis) · <strong>Editor</strong> (scoped writes) · <strong>Verifier</strong> (tests &amp; lint).
        Configure concurrency limits and iteration caps.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">⚙️ .neuralinverseagent Config</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Drop a <code>.neuralinverseagent</code> JSON file in your workspace root to override tiers, block commands,
        and set iteration limits per project.
      </div>
    </div>
  </div>

  <div style="font-size:12px; color:var(--vscode-descriptionForeground);">
    Open the <strong>Agent Manager</strong> window to configure and launch your first agent workflow.
  </div>
</div>
`;
