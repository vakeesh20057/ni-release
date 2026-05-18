/*---------------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

export default () => `
<div style="padding:20px 24px; font-family:var(--vscode-font-family); color:var(--vscode-foreground); height:100%; box-sizing:border-box;">
  <h2 style="margin:0 0 8px; font-size:17px; font-weight:600;">Bring Your Own LLM</h2>
  <p style="margin:0 0 20px; font-size:13px; color:var(--vscode-descriptionForeground); line-height:1.5;">
    Neural Inverse works with any AI provider. No vendor lock-in — connect your existing API keys or run a fully local model.
  </p>

  <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">☁️ Cloud Providers</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Anthropic Claude, OpenAI GPT-4, Google Gemini, DeepSeek, OpenRouter. Paste your API key and start immediately.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🔒 Local &amp; Private</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Ollama, vLLM, LM Studio, or any OpenAI-compatible endpoint. Code stays on your machine.
      </div>
    </div>
    <div style="border:1px solid var(--vscode-panel-border); border-radius:6px; padding:14px 16px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">🚀 Enterprise Cloud Deploy</div>
      <div style="font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.5;">
        Deploy managed model instances on AWS, Azure, or GCP via the Agent Manager → Models tab.
      </div>
    </div>
  </div>

  <div style="font-size:12px; color:var(--vscode-descriptionForeground);">
    Open <strong>Settings → AI Providers</strong> to add your first model, then come back and start chatting.
  </div>
</div>
`;
