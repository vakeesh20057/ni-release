import * as vscode from 'vscode';
import * as https from 'node:https';
import * as http from 'node:http';
import { Storage } from './storage';

interface WorkspaceItem {
	name: string;
	owner: string;
	status: string;
}

export class WorkspaceProvider implements vscode.TreeDataProvider<WorkspaceItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private workspaces: WorkspaceItem[] = [];

	constructor(
		private readonly storage: Storage,
		private readonly output: vscode.OutputChannel,
	) {
		this.refresh();
	}

	refresh(): void {
		this.fetchWorkspaces().then(
			(items) => {
				this.workspaces = items;
				this._onDidChangeTreeData.fire();
			},
			(err) => {
				this.output.appendLine(`Failed to fetch workspaces: ${err}`);
			},
		);
	}

	getTreeItem(element: WorkspaceItem): vscode.TreeItem {
		const item = new vscode.TreeItem(`${element.owner}/${element.name}`);
		item.description = element.status;
		item.contextValue = 'workspace';
		item.command = {
			command: 'neuralinverse.cloud.open',
			title: 'Open Workspace',
		};
		return item;
	}

	getChildren(): WorkspaceItem[] {
		return this.workspaces;
	}

	private async fetchWorkspaces(): Promise<WorkspaceItem[]> {
		const deployment = this.storage.getDeployment();
		if (!deployment) {
			return [];
		}

		try {
			const data = await this.apiGet<{ workspaces: Array<{ name: string; owner_name: string; latest_build: { status: string } }> }>(
				deployment.url,
				deployment.token,
				'/api/v2/workspaces?q=owner:me',
			);
			return (data.workspaces || []).map((w) => ({
				name: w.name,
				owner: w.owner_name,
				status: w.latest_build?.status || 'unknown',
			}));
		} catch {
			return [];
		}
	}

	private apiGet<T>(baseUrl: string, token: string, apiPath: string): Promise<T> {
		return new Promise((resolve, reject) => {
			const url = new URL(apiPath, baseUrl);
			const mod = url.protocol === 'https:' ? https : http;
			const req = mod.get(
				url,
				{ headers: { 'Coder-Session-Token': token, Accept: 'application/json' } },
				(res) => {
					const chunks: Buffer[] = [];
					res.on('data', (c: Buffer) => chunks.push(c));
					res.on('end', () => {
						try {
							resolve(JSON.parse(Buffer.concat(chunks).toString()));
						} catch (e) {
							reject(e);
						}
					});
				},
			);
			req.on('error', reject);
		});
	}
}
