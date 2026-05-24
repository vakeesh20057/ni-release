/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { IWorkflowDefinition } from '../../common/workflowTypes.js';
import { IComposerNode, IComposerEdge, IViewport, NodeType } from './model/composerModel.js';

import { IGraphValidationResult } from './edges/edgeValidator.js';

export interface IComposerModelSnapshot {
	readonly nodes: ReadonlyMap<string, IComposerNode>;
	readonly edges: ReadonlyMap<string, IComposerEdge>;
	readonly selection: ReadonlySet<string>;
	readonly viewport: Readonly<IViewport>;
}

export interface IWorkflowComposerService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeModel: Event<void>;
	readonly onDidSave: Event<IWorkflowDefinition>;
	readonly onDidStartRun: Event<string>;

	readonly isOpen: boolean;
	readonly isDirty: boolean;
	readonly currentWorkflowId: string | undefined;

	openWorkflow(id: string): Promise<void>;
	createNew(templateId?: string): void;
	close(): void;
	save(): Promise<void>;
	saveAs(id: string, name: string): Promise<void>;

	runCurrent(): Promise<string>;
	cancelRun(runId: string): void;

	getModel(): IComposerModelSnapshot;
	addNode(type: NodeType, position: { x: number; y: number }, config?: Record<string, unknown>): string;
	removeNode(id: string): void;
	addEdge(sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string): string | null;
	removeEdge(id: string): void;

	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;

	autoLayout(): void;
	zoomToFit(): void;
	validate(): IGraphValidationResult;

	mount(container: HTMLElement): void;
	unmount(): void;
}

export const IWorkflowComposerService = createDecorator<IWorkflowComposerService>('workflowComposerService');
