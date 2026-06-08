/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IMCPService } from './mcpService.js';
import { MCPServerOfName, MCPConfigFileJSON, MCPToolCallParams, RawMCPToolCall } from './mcpServiceTypes.js';
import { InternalToolInfo } from './prompt/prompts.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { MCPUserStateOfName } from './voidSettingsTypes.js';

const MCP_CONFIG_FILE_NAME = 'mcp.json';
const MCP_CONFIG_SAMPLE_STRING = JSON.stringify({ mcpServers: {} }, null, 2);

// Web implementation of MCPService.
// stdio MCP servers can't run in browser (no process spawning).
// HTTP/SSE MCP servers work — the channel calls are replaced with direct SDK calls here.
// For now this is a functional stub: config file management works, tool calling is no-op.
class MCPServiceWeb extends Disposable implements IMCPService {
	readonly _serviceBrand: undefined;

	state: { mcpServerOfName: MCPServerOfName; error: string | undefined } = {
		mcpServerOfName: {},
		error: undefined,
	};

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
	) {
		super();
		this._initialize();
	}

	private async _initialize() {
		try {
			await this.voidSettingsService.waitForInitState;
			const uri = await this._getMCPConfigFilePath();
			const exists = await this._configFileExists(uri);
			if (!exists) {
				await this.fileService.createFile(uri);
				await this.fileService.writeFile(uri, VSBuffer.fromString(MCP_CONFIG_SAMPLE_STRING));
			}
			this._register(this.fileService.watch(uri));
			this._register(this.fileService.onDidFilesChange(async e => {
				if (e.contains(uri)) { await this._parseMCPConfigFile(); }
			}));
			await this._parseMCPConfigFile();
		} catch (e) {
			console.error('MCPServiceWeb init error:', e);
		}
	}

	private async _getMCPConfigFilePath(): Promise<URI> {
		const appName = this.productService.dataFolderName;
		const userHome = await this.pathService.userHome();
		return URI.joinPath(userHome, appName, MCP_CONFIG_FILE_NAME);
	}

	private async _configFileExists(uri: URI): Promise<boolean> {
		try { await this.fileService.stat(uri); return true; } catch { return false; }
	}

	private async _parseMCPConfigFile(): Promise<void> {
		try {
			const uri = await this._getMCPConfigFilePath();
			const content = await this.fileService.readFile(uri);
			const json = JSON.parse(content.value.toString()) as MCPConfigFileJSON;
			if (!json.mcpServers) { return; }

			const oldNames = Object.keys(this.state.mcpServerOfName);
			const newNames = Object.keys(json.mcpServers);
			const added = newNames.filter(n => !oldNames.includes(n));
			const removed = oldNames.filter(n => !newNames.includes(n));

			const addedState: MCPUserStateOfName = {};
			for (const n of added) { addedState[n] = { isOn: true }; }
			await this.voidSettingsService.addMCPUserStateOfNames(addedState);
			await this.voidSettingsService.removeMCPUserStateOfNames(removed);

			// Mark all as 'unavailable' in web — no process spawning
			const newServerOfName: MCPServerOfName = {};
			for (const name of newNames) {
				newServerOfName[name] = { status: 'error', error: 'stdio MCP servers are not supported in web mode. Use HTTP/SSE MCP servers.' };
			}
			this.state = { ...this.state, mcpServerOfName: newServerOfName };
			this._onDidChangeState.fire();
		} catch (e) {
			this.state = { ...this.state, error: `Error parsing MCP config: ${e}` };
			this._onDidChangeState.fire();
		}
	}

	async revealMCPConfigFile(): Promise<void> {
		try {
			const uri = await this._getMCPConfigFilePath();
			await this.editorService.openEditor({ resource: uri, options: { pinned: true, revealIfOpened: true } });
		} catch (e) { console.error('Error opening MCP config file:', e); }
	}

	async toggleServerIsOn(_serverName: string, _isOn: boolean): Promise<void> {
		// no-op in web — no process to toggle
	}

	getMCPTools(): InternalToolInfo[] | undefined {
		// HTTP MCP servers could expose tools here in future
		return undefined;
	}

	async callMCPTool(toolData: MCPToolCallParams): Promise<{ result: RawMCPToolCall }> {
		return { result: { event: 'error', toolName: toolData.toolName, text: 'MCP tool calls are not supported in web mode.' } };
	}

	stringifyResult(result: RawMCPToolCall): string {
		if (result.event === 'text') { return result.text; }
		if (result.event === 'image') { return `[Image: ${result.image.mimeType}]`; }
		if (result.event === 'audio') { return '[Audio content]'; }
		if (result.event === 'resource') { return '[Resource content]'; }
		return JSON.stringify(result);
	}
}

registerSingleton(IMCPService, MCPServiceWeb, InstantiationType.Eager);
