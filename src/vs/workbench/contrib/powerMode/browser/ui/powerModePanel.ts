/*---------------------------------------------------------------------------------------------
 *  Original: MIT License - Copyright (c) SST (opencode)
 *  Modified: Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * True TUI terminal interface for Power Mode.
 * Everything is a character on a grid. No CSS decorations.
 * Modeled after Claude Code / OpenCode ink TUI.
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

		body {
			font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
			background: #1a2332;
			color: #c8d3e0;
			height: 100vh;
			overflow: hidden;
			font-size: 13px;
			line-height: 1.45;
			-webkit-font-smoothing: antialiased;
		}

		::-webkit-scrollbar { width: 8px; }
		::-webkit-scrollbar-track { background: #1a2332; }
		::-webkit-scrollbar-thumb { background: #2a3a4e; }

		.shell {
			display: flex;
			flex-direction: column;
			height: 100vh;
		}

		/* ── Top bar: just a line of text ──────────────── */
		.topbar {
			padding: 6px 12px;
			background: #151d2b;
			color: #7a8a9e;
			font-size: 13px;
			display: flex;
			justify-content: space-between;
			border-bottom: 1px solid #2a3545;
		}

		.topbar .brand { color: #5eaed6; font-weight: bold; }
		.topbar .agent-label { color: #7a8a9e; }
		.topbar .agent-name { color: #5ec990; font-weight: bold; }
		.topbar .sep { color: #3a4a5e; margin: 0 6px; }

		.topbar-right { display: flex; gap: 12px; }

		.topbar-action {
			background: none;
			border: none;
			color: #5a6a7e;
			font-family: inherit;
			font-size: 13px;
			cursor: pointer;
			padding: 0;
		}
		.topbar-action:hover { color: #c8d3e0; }
		.topbar-action.stop-btn { color: #d06060; display: none; }
		.topbar-action.stop-btn.on { display: inline; }

		/* ── Scrollable output ─────────────────────────── */
		.output {
			flex: 1;
			overflow-y: auto;
			padding: 8px 12px;
		}

		/* ── Welcome screen ────────────────────────────── */
		.welcome {
			text-align: center;
			padding: 60px 0 20px;
			color: #5a6a7e;
		}
		.welcome .title {
			color: #5eaed6;
			font-weight: bold;
			font-size: 14px;
			margin-bottom: 2px;
		}
		.welcome .sub { color: #4a5a6e; }
		.welcome .hint {
			margin-top: 16px;
			color: #4a5a6e;
			font-size: 12px;
		}
		.welcome .hint .key {
			color: #7a8a9e;
			background: #222e3e;
			padding: 1px 4px;
		}

		/* ── User input line ───────────────────────────── */
		.u-line {
			margin: 10px 0 2px;
		}
		.u-prompt { color: #5eaed6; }
		.u-text { color: #e0e8f0; }

		/* ── Assistant block ───────────────────────────── */
		.a-block {
			margin: 2px 0 10px;
			padding-left: 2px;
		}

		/* Text output - plain */
		.a-text {
			color: #c8d3e0;
			white-space: pre-wrap;
			word-break: break-word;
		}

		/* Reasoning - dimmed */
		.a-reasoning {
			color: #5a6a7e;
			white-space: pre-wrap;
			font-style: italic;
		}

		/* ── Tool call block (TUI style) ───────────────── */
		.t-block {
			margin: 4px 0;
		}

		.t-header {
			cursor: pointer;
			user-select: none;
		}

		.t-icon { display: inline; }
		.t-icon.pending { color: #5a6a7e; }
		.t-icon.running { color: #5eaed6; }
		.t-icon.completed { color: #5ec990; }
		.t-icon.error { color: #d06060; }

		.t-name { color: #b08cd6; font-weight: bold; }
		.t-title { color: #7a8a9e; }
		.t-time { color: #4a5a6e; }

		.t-output {
			color: #5a6a7e;
			white-space: pre-wrap;
			font-size: 12px;
			max-height: 0;
			overflow: hidden;
			padding-left: 4px;
		}
		.t-output.open {
			max-height: 400px;
			overflow-y: auto;
		}

		.t-error {
			color: #d06060;
			font-size: 12px;
			padding-left: 4px;
		}

		/* ── Step marker ───────────────────────────────── */
		.step-mark {
			color: #3a4a5e;
			font-size: 12px;
			margin: 4px 0;
		}

		/* ── Spinner ───────────────────────────────────── */
		.spinner {
			color: #5a6a7e;
			font-size: 12px;
			margin: 4px 0 4px 2px;
			display: none;
		}
		.spinner.on { display: block; }
		.spinner .dots::after {
			content: '';
			animation: d 1.2s steps(4) infinite;
		}
		@keyframes d {
			0% { content: ''; }
			25% { content: '.'; }
			50% { content: '..'; }
			75% { content: '...'; }
		}

		/* ── Error ─────────────────────────────────────── */
		.err-line { color: #d06060; margin: 2px 0; }

		/* ── Prompt area at bottom ─────────────────────── */
		.prompt-area {
			background: #151d2b;
			border-top: 1px solid #2a3545;
			padding: 6px 12px 4px;
		}

		.prompt-row {
			display: flex;
			align-items: flex-end;
		}

		.prompt-char {
			color: #5eaed6;
			font-weight: bold;
			padding-right: 6px;
			padding-bottom: 1px;
			flex-shrink: 0;
		}

		#input {
			flex: 1;
			background: none;
			border: none;
			color: #e0e8f0;
			font-family: inherit;
			font-size: 13px;
			line-height: 1.45;
			resize: none;
			outline: none;
			max-height: 100px;
			min-height: 19px;
		}
		#input::placeholder { color: #3a4a5e; }

		.prompt-hints {
			font-size: 11px;
			color: #3a4a5e;
			padding: 2px 0 0 0;
		}
		.prompt-hints .key {
			color: #5a6a7e;
			background: #222e3e;
			padding: 0 3px;
			font-size: 10px;
		}
	</style>
</head>
<body>
	<div class="shell">
		<div class="topbar">
			<div>
				<span class="brand">neural inverse</span>
				<span class="sep">|</span>
				<span class="agent-label">agent: </span><span class="agent-name" id="agentName">build</span>
				<span id="sessionInfo"></span>
			</div>
			<div class="topbar-right">
				<button class="topbar-action" id="btnNew">new session</button>
				<button class="topbar-action stop-btn" id="btnStop">stop</button>
			</div>
		</div>

		<div class="output" id="output">
			<div class="welcome" id="welcome">
				<div class="title">neural inverse power mode</div>
				<div class="sub">agentic coding terminal</div>
				<div class="hint">Type a task below and press <span class="key">Enter</span> to start</div>
			</div>
			<div id="stream"></div>
			<div class="spinner" id="spinner"><span class="dots">thinking</span></div>
		</div>

		<div class="prompt-area">
			<div class="prompt-row">
				<span class="prompt-char">&gt;</span>
				<textarea id="input" rows="1" placeholder="What do you want to build?" autofocus></textarea>
			</div>
			<div class="prompt-hints">
				<span class="key">Enter</span> send &nbsp;&nbsp; <span class="key">Shift+Enter</span> newline
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
		const btnStop = $('btnStop');
		const btnNew = $('btnNew');
		const agentName = $('agentName');
		const sessionInfo = $('sessionInfo');

		let sid = null;
		let busy = false;
		let pending = null;

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
			input.style.height = Math.min(input.scrollHeight, 100) + 'px';
		}
		input.addEventListener('input', resize);

		function bottom() { output.scrollTop = output.scrollHeight; }

		function esc(s) {
			const d = document.createElement('span');
			d.textContent = s;
			return d.innerHTML;
		}

		function setBusy(b) {
			busy = b;
			btnStop.className = 'topbar-action stop-btn' + (b ? ' on' : '');
			spinner.className = 'spinner' + (b ? ' on' : '');
			input.disabled = b;
		}

		// ── Render ─────────────────────────────────────────
		function userLine(msg) {
			welcome.style.display = 'none';
			const text = msg.parts && msg.parts[0] ? msg.parts[0].text : '';
			const div = document.createElement('div');
			div.className = 'u-line';
			div.innerHTML = '<span class="u-prompt">\\u276f </span><span class="u-text">' + esc(text) + '</span>';
			stream.appendChild(div);
			bottom();
		}

		function assistantStart(msg) {
			const div = document.createElement('div');
			div.className = 'a-block';
			div.id = 'a-' + msg.id;
			stream.appendChild(div);
			bottom();
		}

		function part(mid, p) {
			const box = $('a-' + mid);
			if (!box) return;
			let el = $('p-' + p.id);

			switch (p.type) {
				case 'text':
					if (!el) { el = document.createElement('div'); el.id = 'p-' + p.id; el.className = 'a-text'; box.appendChild(el); }
					el.textContent = p.text;
					break;

				case 'reasoning':
					if (!el) { el = document.createElement('div'); el.id = 'p-' + p.id; el.className = 'a-reasoning'; box.appendChild(el); }
					el.textContent = p.text;
					break;

				case 'tool': {
					if (!el) { el = document.createElement('div'); el.id = 'p-' + p.id; el.className = 't-block'; box.appendChild(el); }
					const st = p.state;
					const ic = { pending: '\\u25cb', running: '\\u25cf', completed: '\\u2713', error: '\\u2717' };
					let tm = '';
					if (st.time && st.time.end) tm = ' ' + ((st.time.end - st.time.start) / 1000).toFixed(1) + 's';

					let h = '<div class="t-header" onclick="var o=this.nextElementSibling;if(o)o.classList.toggle(\\\'open\\\')">';
					h += '<span class="t-icon ' + st.status + '">' + (ic[st.status] || '') + '</span> ';
					h += '<span class="t-name">' + esc(p.toolName) + '</span>';
					if (st.title) h += ' <span class="t-title">' + esc(st.title) + '</span>';
					if (tm) h += ' <span class="t-time">' + tm + '</span>';
					h += '</div>';

					if (st.output) {
						const preview = st.output.length > 600 ? st.output.substring(0, 600) + '\\n...' : st.output;
						h += '<div class="t-output">' + esc(preview) + '</div>';
					}
					if (st.error) h += '<div class="t-error">' + esc(st.error) + '</div>';
					el.innerHTML = h;
					break;
				}

				case 'step-start':
					break;

				case 'step-finish':
					if (!el) {
						el = document.createElement('div');
						el.id = 'p-' + p.id;
						el.className = 'step-mark';
						let lbl = '---';
						if (p.tokens) lbl = '--- ' + p.tokens.input + ' in / ' + p.tokens.output + ' out';
						if (p.cost) lbl += ' $' + p.cost.toFixed(4);
						el.textContent = lbl;
						box.appendChild(el);
					}
					break;
			}
			bottom();
		}

		// ── Messages from extension ────────────────────────
		window.addEventListener('message', e => {
			const m = e.data;
			switch (m.type) {
				case 'session-created':
					sid = m.session.id;
					agentName.textContent = m.session.agentId;
					stream.innerHTML = '';
					welcome.style.display = 'block';
					if (pending) {
						const t = pending; pending = null;
						vscode.postMessage({ type: 'send-message', sessionId: sid, text: t });
					}
					break;

				case 'session-updated':
					setBusy(m.status === 'busy');
					break;

				case 'message-created':
					if (m.message.role === 'user') userLine(m.message);
					else assistantStart(m.message);
					break;

				case 'part-updated':
					part(m.messageId, m.part);
					break;

				case 'part-delta': {
					const el = $('p-' + m.partId);
					if (el) { el.textContent = (el.textContent || '') + m.delta; bottom(); }
					break;
				}

				case 'sessions-list':
					if (m.sessions.length > 0 && !sid) {
						sid = m.sessions[0].id;
						agentName.textContent = m.sessions[0].agentId;
					}
					break;

				case 'error':
					welcome.style.display = 'none';
					const err = document.createElement('div');
					err.className = 'err-line';
					err.textContent = 'error: ' + m.error;
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
