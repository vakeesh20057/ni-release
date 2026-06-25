/*---------------------------------------------------------------------------------------------
 *  Original: MIT License - Copyright (c) SST (opencode)
 *  Modified: Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * Power Mode TUI panel -- full rewrite modeled after Claude Code's terminal rendering.
 * Dark theme, gutter brackets, animated status dots, streaming markdown, collapsible thinking.
 */
export function getPowerModeHTML(nonce: string): string {
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style nonce="${nonce}">
		* { margin: 0; padding: 0; box-sizing: border-box; }

		:root {
			--text: #ffffff;
			--dimmed: #999999;
			--error: rgb(255,107,128);
			--success: rgb(78,186,101);
			--warning: rgb(255,193,7);
			--suggestion: rgb(177,185,249);
			--claude: rgb(215,119,87);
			--subtle: rgb(80,80,80);
			--inactive: #999999;
			--user-msg-bg: rgb(55,55,55);
			--actions-bg: rgb(44,50,62);
			--selection-bg: rgb(38,79,120);
			--bg: #1a1a1a;
			--surface: #222222;
			--border: #333333;
			--gutter: #555555;
			--tool-name: rgb(177,185,249);
		}

		body {
			font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
			background: var(--bg);
			color: var(--text);
			height: 100vh;
			overflow: hidden;
			font-size: 13px;
			line-height: 1.5;
			-webkit-font-smoothing: antialiased;
		}

		::selection { background: var(--selection-bg); }
		::-webkit-scrollbar { width: 6px; }
		::-webkit-scrollbar-track { background: transparent; }
		::-webkit-scrollbar-thumb { background: var(--subtle); border-radius: 3px; }

		.shell {
			display: flex;
			flex-direction: column;
			height: 100vh;
		}

		/* -- Top bar -- */
		.topbar {
			padding: 8px 16px;
			background: var(--surface);
			display: flex;
			justify-content: space-between;
			align-items: center;
			border-bottom: 1px solid var(--border);
			min-height: 36px;
		}
		.topbar-left { display: flex; align-items: center; gap: 8px; }
		.brand { color: var(--claude); font-weight: 700; font-size: 13px; }
		.sep { color: var(--subtle); }
		.agent-name { color: var(--dimmed); font-size: 12px; }
		.topbar-right { display: flex; gap: 12px; align-items: center; }
		.topbar-btn {
			background: none;
			border: 1px solid var(--border);
			color: var(--dimmed);
			font-family: inherit;
			font-size: 11px;
			padding: 2px 8px;
			border-radius: 3px;
			cursor: pointer;
		}
		.topbar-btn:hover { color: var(--text); border-color: var(--dimmed); }
		.topbar-btn.danger { border-color: var(--error); color: var(--error); display: none; }
		.topbar-btn.danger.on { display: inline-flex; }

		/* -- Output area -- */
		.output {
			flex: 1;
			overflow-y: auto;
			padding: 12px 16px;
		}

		/* -- Welcome -- */
		.welcome {
			padding: 48px 0 24px;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 4px;
		}
		.welcome-title { color: var(--claude); font-weight: 700; font-size: 15px; }
		.welcome-sub { color: var(--dimmed); font-size: 12px; }
		.welcome-hint { color: var(--subtle); font-size: 11px; margin-top: 12px; }
		.welcome-hint kbd {
			background: var(--surface);
			border: 1px solid var(--border);
			padding: 1px 4px;
			border-radius: 2px;
			font-size: 10px;
			color: var(--dimmed);
		}

		/* -- Messages -- */
		.msg { margin-top: 12px; }
		.msg:first-child { margin-top: 0; }

		/* User message */
		.msg-user {
			display: flex;
			align-items: flex-start;
			gap: 0;
		}
		.msg-user-dot {
			flex-shrink: 0;
			width: 16px;
			color: var(--text);
			font-size: 10px;
			line-height: 1.5;
			padding-top: 2px;
		}
		.msg-user-text {
			color: var(--text);
			font-weight: 600;
			white-space: pre-wrap;
			word-break: break-word;
		}

		/* Assistant response block */
		.msg-assistant { margin-top: 4px; }

		/* Gutter line (the bracket prefix) */
		.gutter-row {
			display: flex;
			align-items: flex-start;
		}
		.gutter {
			flex-shrink: 0;
			width: 20px;
			color: var(--gutter);
			user-select: none;
			font-size: 14px;
			line-height: 1.5;
		}
		.gutter-content {
			flex: 1;
			min-width: 0;
		}

		/* Text content */
		.a-text {
			color: var(--text);
			white-space: pre-wrap;
			word-break: break-word;
		}

		/* Thinking/reasoning */
		.thinking-header {
			display: flex;
			align-items: center;
			gap: 6px;
			cursor: pointer;
			user-select: none;
			color: var(--dimmed);
			font-style: italic;
			font-size: 12px;
		}
		.thinking-header:hover { color: var(--inactive); }
		.thinking-marker { font-style: normal; }
		.thinking-hint {
			font-size: 10px;
			color: var(--subtle);
			font-style: normal;
		}
		.thinking-body {
			display: none;
			padding-left: 16px;
			padding-top: 4px;
			color: var(--dimmed);
			font-style: italic;
			font-size: 12px;
			white-space: pre-wrap;
			word-break: break-word;
			max-height: 300px;
			overflow-y: auto;
		}
		.thinking-body.open { display: block; }

		/* -- Tool calls -- */
		.tool-block { margin: 6px 0; }

		.tool-header {
			display: flex;
			align-items: center;
			gap: 0;
			cursor: pointer;
			user-select: none;
		}

		.tool-dot {
			flex-shrink: 0;
			width: 16px;
			font-size: 11px;
			text-align: center;
		}
		.tool-dot.pending { color: var(--dimmed); }
		.tool-dot.running { color: var(--suggestion); }
		.tool-dot.completed { color: var(--success); }
		.tool-dot.error { color: var(--error); }

		@keyframes blink {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.2; }
		}
		.tool-dot.running { animation: blink 1s ease-in-out infinite; }

		.tool-name {
			font-weight: 700;
			color: var(--tool-name);
			flex-shrink: 0;
		}
		.tool-args {
			color: var(--dimmed);
			margin-left: 2px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.tool-time {
			color: var(--subtle);
			margin-left: 8px;
			font-size: 11px;
			flex-shrink: 0;
		}

		/* Tool output (indented under gutter) */
		.tool-output-wrap {
			display: none;
			margin-top: 2px;
		}
		.tool-output-wrap.open { display: block; }

		.tool-output {
			color: var(--dimmed);
			font-size: 12px;
			white-space: pre-wrap;
			word-break: break-word;
			max-height: 400px;
			overflow-y: auto;
			padding: 4px 0;
		}
		.tool-error {
			color: var(--error);
			font-size: 12px;
			padding: 2px 0;
		}

		/* -- Step separator -- */
		.step-sep {
			color: var(--subtle);
			font-size: 11px;
			margin: 8px 0 4px;
			padding-left: 20px;
		}

		/* -- Spinner / thinking indicator -- */
		.spinner-area {
			display: none;
			padding: 8px 0 4px 20px;
			color: var(--dimmed);
			font-style: italic;
			font-size: 12px;
		}
		.spinner-area.on { display: flex; align-items: center; gap: 8px; }
		.spinner-dots {
			display: inline-flex;
			gap: 2px;
		}
		.spinner-dot {
			width: 4px;
			height: 4px;
			background: var(--dimmed);
			border-radius: 50%;
			animation: pulse 1.4s ease-in-out infinite;
		}
		.spinner-dot:nth-child(2) { animation-delay: 0.2s; }
		.spinner-dot:nth-child(3) { animation-delay: 0.4s; }
		@keyframes pulse {
			0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
			40% { opacity: 1; transform: scale(1); }
		}

		/* -- Error -- */
		.err-line {
			color: var(--error);
			margin: 8px 0;
			padding-left: 20px;
		}

		/* -- Prompt area -- */
		.prompt-area {
			background: var(--surface);
			border-top: 1px solid var(--border);
			padding: 10px 16px 8px;
		}
		.prompt-row {
			display: flex;
			align-items: flex-end;
			gap: 0;
		}
		.prompt-char {
			color: var(--claude);
			font-weight: 700;
			width: 20px;
			flex-shrink: 0;
			padding-bottom: 1px;
		}
		#input {
			flex: 1;
			background: none;
			border: none;
			color: var(--text);
			font-family: inherit;
			font-size: 13px;
			line-height: 1.5;
			resize: none;
			outline: none;
			max-height: 120px;
			min-height: 20px;
		}
		#input::placeholder { color: var(--subtle); }
		.prompt-hints {
			font-size: 10px;
			color: var(--subtle);
			padding: 3px 0 0 20px;
			display: flex;
			gap: 12px;
		}
		.prompt-hints kbd {
			background: var(--surface);
			border: 1px solid var(--border);
			padding: 0 3px;
			border-radius: 2px;
			font-size: 9px;
			color: var(--dimmed);
		}
	</style>
</head>
<body>
	<div class="shell">
		<div class="topbar">
			<div class="topbar-left">
				<span class="brand">Neural Inverse</span>
				<span class="sep">/</span>
				<span class="agent-name" id="agentName">power mode</span>
			</div>
			<div class="topbar-right">
				<button class="topbar-btn" id="btnNew">New</button>
				<button class="topbar-btn danger" id="btnStop">Stop</button>
			</div>
		</div>

		<div class="output" id="output">
			<div class="welcome" id="welcome">
				<div class="welcome-title">Neural Inverse Power Mode</div>
				<div class="welcome-sub">Agentic coding terminal</div>
				<div class="welcome-hint">Type a task and press <kbd>Enter</kbd> to start</div>
			</div>
			<div id="stream"></div>
			<div class="spinner-area" id="spinner">
				<div class="spinner-dots"><div class="spinner-dot"></div><div class="spinner-dot"></div><div class="spinner-dot"></div></div>
				<span id="spinnerLabel">Thinking</span>
			</div>
		</div>

		<div class="prompt-area">
			<div class="prompt-row">
				<span class="prompt-char">&gt;</span>
				<textarea id="input" rows="1" placeholder="What do you want to build?" autofocus></textarea>
			</div>
			<div class="prompt-hints">
				<span><kbd>Enter</kbd> send</span>
				<span><kbd>Shift+Enter</kbd> newline</span>
			</div>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const $ = id => document.getElementById(id);
		const input = $('input');
		const output = $('output');
		const stream = $('stream');
		const welcome = $('welcome');
		const spinner = $('spinner');
		const spinnerLabel = $('spinnerLabel');
		const btnStop = $('btnStop');
		const btnNew = $('btnNew');
		const agentName = $('agentName');

		let sid = null;
		let busy = false;
		let pending = null;
		let toolExpandState = {};

		function send() {
			const t = input.value.trim();
			if (!t || busy) return;
			input.value = '';
			resize();
			if (!sid) { pending = t; vscode.postMessage({ type: 'create-session' }); return; }
			vscode.postMessage({ type: 'send-message', sessionId: sid, text: t });
		}

		input.addEventListener('keydown', e => {
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
		});
		btnStop.addEventListener('click', () => { if (sid) vscode.postMessage({ type: 'cancel', sessionId: sid }); });
		btnNew.addEventListener('click', () => vscode.postMessage({ type: 'create-session' }));

		function resize() {
			input.style.height = 'auto';
			input.style.height = Math.min(input.scrollHeight, 120) + 'px';
		}
		input.addEventListener('input', resize);

		function bottom() { output.scrollTop = output.scrollHeight; }

		function esc(s) {
			if (!s) return '';
			return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
		}

		function setBusy(b) {
			busy = b;
			btnStop.className = 'topbar-btn danger' + (b ? ' on' : '');
			spinner.className = 'spinner-area' + (b ? ' on' : '');
			input.disabled = b;
			if (!b) spinnerLabel.textContent = 'Thinking';
		}

		// -- Render helpers --

		function renderUserMsg(msg) {
			welcome.style.display = 'none';
			const text = msg.parts && msg.parts[0] ? msg.parts[0].text : '';
			const div = document.createElement('div');
			div.className = 'msg msg-user';
			div.innerHTML = '<span class="msg-user-dot">\\u25cf</span><span class="msg-user-text">' + esc(text) + '</span>';
			stream.appendChild(div);
			bottom();
		}

		function renderAssistantStart(msg) {
			const div = document.createElement('div');
			div.className = 'msg msg-assistant';
			div.id = 'a-' + msg.id;
			stream.appendChild(div);
			bottom();
		}

		function gutterWrap(content) {
			return '<div class="gutter-row"><span class="gutter">\\u23bf</span><div class="gutter-content">' + content + '</div></div>';
		}

		function renderPart(mid, p) {
			const box = $('a-' + mid);
			if (!box) return;
			let el = $('p-' + p.id);

			switch (p.type) {
				case 'text': {
					if (!el) {
						el = document.createElement('div');
						el.id = 'p-' + p.id;
						el.innerHTML = gutterWrap('<div class="a-text"></div>');
						box.appendChild(el);
					}
					const textEl = el.querySelector('.a-text');
					if (textEl) textEl.textContent = p.text || '';
					break;
				}

				case 'reasoning': {
					if (!el) {
						el = document.createElement('div');
						el.id = 'p-' + p.id;
						const hid = 'th-' + p.id;
						el.innerHTML = gutterWrap(
							'<div class="thinking-header" data-target="' + hid + '">' +
								'<span class="thinking-marker">\\u2234</span> Thinking' +
								'<span class="thinking-hint">(click to expand)</span>' +
							'</div>' +
							'<div class="thinking-body" id="' + hid + '"></div>'
						);
						el.querySelector('.thinking-header').addEventListener('click', function() {
							var target = $(this.getAttribute('data-target'));
							if (target) target.classList.toggle('open');
						});
						box.appendChild(el);
					}
					const body = el.querySelector('.thinking-body');
					if (body) body.textContent = p.text || '';
					break;
				}

				case 'tool': {
					if (!el) {
						el = document.createElement('div');
						el.id = 'p-' + p.id;
						el.className = 'tool-block';
						box.appendChild(el);
					}
					const st = p.state || {};
					const status = st.status || 'pending';
					const dot = '\\u25cf';
					let timeStr = '';
					if (st.time && st.time.end) {
						timeStr = ((st.time.end - st.time.start) / 1000).toFixed(1) + 's';
					}

					let argsStr = '';
					if (st.title) argsStr = '(' + esc(st.title) + ')';

					let html = '<div class="tool-header" data-tool-id="' + p.id + '">';
					html += '<span class="tool-dot ' + status + '">' + dot + '</span>';
					html += '<span class="tool-name">' + esc(p.toolName) + '</span>';
					if (argsStr) html += '<span class="tool-args">' + argsStr + '</span>';
					if (timeStr) html += '<span class="tool-time">' + timeStr + '</span>';
					html += '</div>';

					const isOpen = toolExpandState[p.id] || false;
					const hasOutput = st.output || st.error;
					if (hasOutput) {
						html += '<div class="tool-output-wrap' + (isOpen ? ' open' : '') + '" id="tout-' + p.id + '">';
						html += gutterWrap(
							(st.output ? '<div class="tool-output">' + esc(st.output.length > 800 ? st.output.substring(0, 800) + '\\n...' : st.output) + '</div>' : '') +
							(st.error ? '<div class="tool-error">' + esc(st.error) + '</div>' : '')
						);
						html += '</div>';
					}

					el.innerHTML = html;

					el.querySelector('.tool-header').addEventListener('click', function() {
						const wrap = $('tout-' + p.id);
						if (wrap) {
							wrap.classList.toggle('open');
							toolExpandState[p.id] = wrap.classList.contains('open');
						}
					});
					break;
				}

				case 'step-start':
					break;

				case 'step-finish': {
					if (!el) {
						el = document.createElement('div');
						el.id = 'p-' + p.id;
						el.className = 'step-sep';
						let lbl = '';
						if (p.tokens) lbl = p.tokens.input + ' in / ' + p.tokens.output + ' out';
						if (p.cost) lbl += (lbl ? ' | ' : '') + '$' + p.cost.toFixed(4);
						if (lbl) el.textContent = lbl;
						box.appendChild(el);
					}
					break;
				}
			}
			bottom();
		}

		// -- Messages from extension --
		window.addEventListener('message', e => {
			const m = e.data;
			switch (m.type) {
				case 'session-created':
					sid = m.session.id;
					agentName.textContent = m.session.agentId || 'power mode';
					stream.innerHTML = '';
					welcome.style.display = 'flex';
					toolExpandState = {};
					if (pending) {
						const t = pending; pending = null;
						vscode.postMessage({ type: 'send-message', sessionId: sid, text: t });
					}
					break;

				case 'session-updated':
					setBusy(m.status === 'busy');
					break;

				case 'message-created':
					if (m.message.role === 'user') renderUserMsg(m.message);
					else renderAssistantStart(m.message);
					break;

				case 'part-updated':
					renderPart(m.messageId, m.part);
					break;

				case 'part-delta': {
					const el = $('p-' + m.partId);
					if (el) {
						const textEl = el.querySelector('.a-text') || el.querySelector('.thinking-body');
						if (textEl) {
							textEl.textContent = (textEl.textContent || '') + m.delta;
						}
						bottom();
					}
					break;
				}

				case 'sessions-list':
					if (m.sessions.length > 0 && !sid) {
						sid = m.sessions[0].id;
						agentName.textContent = m.sessions[0].agentId || 'power mode';
					}
					break;

				case 'error':
					welcome.style.display = 'none';
					const err = document.createElement('div');
					err.className = 'err-line';
					err.textContent = m.error;
					stream.appendChild(err);
					bottom();
					break;
			}
		});

		vscode.postMessage({ type: 'ready' });
		vscode.postMessage({ type: 'list-sessions' });
	</script>
</body>
</html>`;
}
