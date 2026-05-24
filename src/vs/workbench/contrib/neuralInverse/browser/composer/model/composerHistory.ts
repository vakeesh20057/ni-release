/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ComposerModel, ICommand, IComposerEdge, IComposerNode, IViewport } from './composerModel.js';

const MAX_HISTORY = 100;

export class ComposerHistory extends Disposable {

	private readonly _undoStack: ICommand[] = [];
	private readonly _redoStack: ICommand[] = [];
	private _batchCommands: ICommand[] | null = null;
	private _batchDescription: string = '';

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	get canUndo(): boolean { return this._undoStack.length > 0; }
	get canRedo(): boolean { return this._redoStack.length > 0; }
	get undoDescription(): string | undefined { return this._undoStack[this._undoStack.length - 1]?.description; }
	get redoDescription(): string | undefined { return this._redoStack[this._redoStack.length - 1]?.description; }

	execute(command: ICommand, model: ComposerModel): void {
		command.execute(model);

		if (this._batchCommands) {
			this._batchCommands.push(command);
		} else {
			this._pushUndo(command);
			this._redoStack.length = 0;
			this._onDidChange.fire();
		}
	}

	undo(model: ComposerModel): void {
		const command = this._undoStack.pop();
		if (!command) { return; }
		command.undo(model);
		this._redoStack.push(command);
		this._onDidChange.fire();
	}

	redo(model: ComposerModel): void {
		const command = this._redoStack.pop();
		if (!command) { return; }
		command.execute(model);
		this._undoStack.push(command);
		this._onDidChange.fire();
	}

	beginBatch(description: string): void {
		this._batchCommands = [];
		this._batchDescription = description;
	}

	endBatch(model: ComposerModel): void {
		const commands = this._batchCommands;
		if (!commands || commands.length === 0) {
			this._batchCommands = null;
			return;
		}
		this._batchCommands = null;

		const batchCmd: ICommand = {
			description: this._batchDescription,
			execute(m: ComposerModel) {
				for (const cmd of commands) { cmd.execute(m); }
			},
			undo(m: ComposerModel) {
				for (let i = commands.length - 1; i >= 0; i--) { commands[i].undo(m); }
			}
		};

		// Already executed during batch, just push to undo
		this._pushUndo(batchCmd);
		this._redoStack.length = 0;
		this._onDidChange.fire();
		void model; // consumed by type system
	}

	clear(): void {
		this._undoStack.length = 0;
		this._redoStack.length = 0;
		this._batchCommands = null;
		this._onDidChange.fire();
	}

	private _pushUndo(command: ICommand): void {
		this._undoStack.push(command);
		if (this._undoStack.length > MAX_HISTORY) {
			this._undoStack.shift();
		}
	}
}

// ─── Built-in Commands ───────────────────────────────────────────────────────

export class AddNodeCommand implements ICommand {
	readonly description: string;
	constructor(private readonly _node: IComposerNode) {
		this.description = `Add ${_node.type} "${_node.label}"`;
	}
	execute(model: ComposerModel): void { model.addNode({ ...this._node }); }
	undo(model: ComposerModel): void { model.removeNode(this._node.id); }
}

export class RemoveNodeCommand implements ICommand {
	readonly description: string;
	private _removedNode: IComposerNode | undefined;
	private _removedEdges: IComposerEdge[] = [];

	constructor(private readonly _nodeId: string) {
		this.description = `Remove node`;
	}
	execute(model: ComposerModel): void {
		this._removedEdges = model.getEdgesForNode(this._nodeId).map(e => ({ ...e }));
		this._removedNode = model.getNode(this._nodeId);
		if (this._removedNode) {
			this._removedNode = { ...this._removedNode };
		}
		model.removeNode(this._nodeId);
	}
	undo(model: ComposerModel): void {
		if (this._removedNode) {
			model.addNode({ ...this._removedNode });
		}
		for (const edge of this._removedEdges) {
			model.addEdge({ ...edge });
		}
	}
}

export class MoveNodeCommand implements ICommand {
	readonly description = 'Move node';
	private _oldX = 0;
	private _oldY = 0;

	constructor(
		private readonly _nodeId: string,
		private readonly _newX: number,
		private readonly _newY: number
	) {}

	execute(model: ComposerModel): void {
		const node = model.getNode(this._nodeId);
		if (node) {
			this._oldX = node.position.x;
			this._oldY = node.position.y;
			model.moveNode(this._nodeId, this._newX, this._newY);
		}
	}
	undo(model: ComposerModel): void {
		model.moveNode(this._nodeId, this._oldX, this._oldY);
	}
}

export class AddEdgeCommand implements ICommand {
	readonly description = 'Add connection';
	constructor(private readonly _edge: IComposerEdge) {}
	execute(model: ComposerModel): void { model.addEdge({ ...this._edge }); }
	undo(model: ComposerModel): void { model.removeEdge(this._edge.id); }
}

export class RemoveEdgeCommand implements ICommand {
	readonly description = 'Remove connection';
	private _removedEdge: IComposerEdge | undefined;

	constructor(private readonly _edgeId: string) {}
	execute(model: ComposerModel): void {
		this._removedEdge = model.getEdge(this._edgeId);
		if (this._removedEdge) {
			this._removedEdge = { ...this._removedEdge };
		}
		model.removeEdge(this._edgeId);
	}
	undo(model: ComposerModel): void {
		if (this._removedEdge) {
			model.addEdge({ ...this._removedEdge });
		}
	}
}

export class UpdateNodeConfigCommand implements ICommand {
	readonly description: string;
	private _oldConfig: Record<string, unknown> = {};

	constructor(
		private readonly _nodeId: string,
		private readonly _patch: Record<string, unknown>,
		description?: string
	) {
		this.description = description || 'Update node config';
	}

	execute(model: ComposerModel): void {
		const node = model.getNode(this._nodeId);
		if (!node) { return; }
		this._oldConfig = {};
		for (const key of Object.keys(this._patch)) {
			this._oldConfig[key] = node.config[key];
		}
		model.updateNode(this._nodeId, { config: { ...node.config, ...this._patch } });
	}
	undo(model: ComposerModel): void {
		const node = model.getNode(this._nodeId);
		if (!node) { return; }
		model.updateNode(this._nodeId, { config: { ...node.config, ...this._oldConfig } });
	}
}

export class UpdateNodeLabelCommand implements ICommand {
	readonly description = 'Rename node';
	private _oldLabel = '';

	constructor(private readonly _nodeId: string, private readonly _newLabel: string) {}

	execute(model: ComposerModel): void {
		const node = model.getNode(this._nodeId);
		if (node) {
			this._oldLabel = node.label;
			model.updateNode(this._nodeId, { label: this._newLabel });
		}
	}
	undo(model: ComposerModel): void {
		model.updateNode(this._nodeId, { label: this._oldLabel });
	}
}

export class SetViewportCommand implements ICommand {
	readonly description = 'Change viewport';
	private _oldViewport: IViewport = { x: 0, y: 0, zoom: 1 };

	constructor(private readonly _newViewport: IViewport) {}

	execute(model: ComposerModel): void {
		this._oldViewport = { ...model.viewport };
		model.setViewport(this._newViewport);
	}
	undo(model: ComposerModel): void {
		model.setViewport(this._oldViewport);
	}
}

export class ToggleNodeEnabledCommand implements ICommand {
	readonly description = 'Toggle node enabled';
	constructor(private readonly _nodeId: string) {}

	execute(model: ComposerModel): void {
		const node = model.getNode(this._nodeId);
		if (node) { model.updateNode(this._nodeId, { enabled: !node.enabled }); }
	}
	undo(model: ComposerModel): void {
		const node = model.getNode(this._nodeId);
		if (node) { model.updateNode(this._nodeId, { enabled: !node.enabled }); }
	}
}
