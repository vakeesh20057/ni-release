/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { IViewport } from '../model/composerModel.js';

export interface ICanvasCoords {
	x: number;
	y: number;
}

export interface ICanvasRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ICanvasConfig {
	gridSize: number;
	gridDotRadius: number;
	gridColor: string;
	backgroundColor: string;
	minZoom: number;
	maxZoom: number;
	snapToGrid: boolean;
}

const DEFAULT_CONFIG: ICanvasConfig = {
	gridSize: 20,
	gridDotRadius: 1,
	gridColor: '#2a2a2a',
	backgroundColor: '#1a1a1a',
	minZoom: 0.25,
	maxZoom: 4,
	snapToGrid: true
};

export class WorkflowCanvas extends Disposable {

	private readonly _config: ICanvasConfig;
	private _container: HTMLElement | null = null;
	private _svgRoot: SVGSVGElement | null = null;
	private _defsElement: SVGDefsElement | null = null;
	private _gridLayer: SVGGElement | null = null;
	private _edgeLayer: SVGGElement | null = null;
	private _nodeLayer: SVGGElement | null = null;
	private _overlayLayer: SVGGElement | null = null;
	private _minimapContainer: HTMLElement | null = null;
	private _viewport: IViewport = { x: 0, y: 0, zoom: 1 };
	private _containerRect: DOMRect | null = null;
	private _resizeObserver: ResizeObserver | null = null;

	private readonly _onDidResize = this._register(new Emitter<{ width: number; height: number }>());
	readonly onDidResize: Event<{ width: number; height: number }> = this._onDidResize.event;

	constructor(config?: Partial<ICanvasConfig>) {
		super();
		this._config = { ...DEFAULT_CONFIG, ...config };
	}

	get svgRoot(): SVGSVGElement | null { return this._svgRoot; }
	get edgeLayer(): SVGGElement | null { return this._edgeLayer; }
	get nodeLayer(): SVGGElement | null { return this._nodeLayer; }
	get overlayLayer(): SVGGElement | null { return this._overlayLayer; }
	get viewport(): IViewport { return this._viewport; }
	get config(): ICanvasConfig { return this._config; }

	mount(container: HTMLElement): void {
		this._container = container;
		container.style.overflow = 'hidden';
		container.style.position = 'relative';
		container.style.backgroundColor = this._config.backgroundColor;

		this._svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		this._svgRoot.setAttribute('width', '100%');
		this._svgRoot.setAttribute('height', '100%');
		this._svgRoot.style.display = 'block';
		this._svgRoot.style.cursor = 'default';

		this._defsElement = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
		this._svgRoot.appendChild(this._defsElement);
		this._createDefs();

		this._gridLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		this._gridLayer.setAttribute('class', 'canvas-grid');
		this._svgRoot.appendChild(this._gridLayer);

		this._edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		this._edgeLayer.setAttribute('class', 'canvas-edges');
		this._svgRoot.appendChild(this._edgeLayer);

		this._nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		this._nodeLayer.setAttribute('class', 'canvas-nodes');
		this._svgRoot.appendChild(this._nodeLayer);

		this._overlayLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		this._overlayLayer.setAttribute('class', 'canvas-overlay');
		this._svgRoot.appendChild(this._overlayLayer);

		container.appendChild(this._svgRoot);

		this._createMinimap();
		this._setupResizeObserver();
		this._updateTransform();
	}

	destroy(): void {
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
		if (this._svgRoot && this._container) {
			this._container.removeChild(this._svgRoot);
		}
		if (this._minimapContainer && this._container) {
			this._container.removeChild(this._minimapContainer);
		}
		this._svgRoot = null;
		this._container = null;
	}

	setViewport(viewport: IViewport): void {
		this._viewport = {
			x: viewport.x,
			y: viewport.y,
			zoom: Math.max(this._config.minZoom, Math.min(this._config.maxZoom, viewport.zoom))
		};
		this._updateTransform();
	}

	pan(dx: number, dy: number): void {
		this._viewport.x += dx;
		this._viewport.y += dy;
		this._updateTransform();
	}

	zoomAt(factor: number, screenX: number, screenY: number): void {
		const oldZoom = this._viewport.zoom;
		const newZoom = Math.max(this._config.minZoom, Math.min(this._config.maxZoom, oldZoom * factor));
		if (newZoom === oldZoom) { return; }

		const canvasPt = this.screenToCanvas(screenX, screenY);
		this._viewport.zoom = newZoom;
		this._viewport.x = screenX - canvasPt.x * newZoom;
		this._viewport.y = screenY - canvasPt.y * newZoom;
		this._updateTransform();
	}

	zoomToFit(bounds: ICanvasRect, padding: number = 60): void {
		if (!this._containerRect) { return; }
		const cw = this._containerRect.width - padding * 2;
		const ch = this._containerRect.height - padding * 2;
		if (cw <= 0 || ch <= 0) { return; }

		const scaleX = cw / bounds.width;
		const scaleY = ch / bounds.height;
		const zoom = Math.max(this._config.minZoom, Math.min(this._config.maxZoom, Math.min(scaleX, scaleY)));

		this._viewport.zoom = zoom;
		this._viewport.x = padding + (cw - bounds.width * zoom) / 2 - bounds.x * zoom;
		this._viewport.y = padding + (ch - bounds.height * zoom) / 2 - bounds.y * zoom;
		this._updateTransform();
	}

	screenToCanvas(screenX: number, screenY: number): ICanvasCoords {
		const rect = this._containerRect;
		if (!rect) { return { x: 0, y: 0 }; }
		const relX = screenX - rect.left;
		const relY = screenY - rect.top;
		return {
			x: (relX - this._viewport.x) / this._viewport.zoom,
			y: (relY - this._viewport.y) / this._viewport.zoom
		};
	}

	canvasToScreen(canvasX: number, canvasY: number): ICanvasCoords {
		const rect = this._containerRect;
		if (!rect) { return { x: 0, y: 0 }; }
		return {
			x: canvasX * this._viewport.zoom + this._viewport.x + rect.left,
			y: canvasY * this._viewport.zoom + this._viewport.y + rect.top
		};
	}

	snapToGrid(value: number): number {
		if (!this._config.snapToGrid) { return value; }
		return Math.round(value / this._config.gridSize) * this._config.gridSize;
	}

	getVisibleBounds(): ICanvasRect {
		if (!this._containerRect) {
			return { x: 0, y: 0, width: 2000, height: 1000 };
		}
		const topLeft = this.screenToCanvas(this._containerRect.left, this._containerRect.top);
		const bottomRight = this.screenToCanvas(
			this._containerRect.left + this._containerRect.width,
			this._containerRect.top + this._containerRect.height
		);
		return {
			x: topLeft.x,
			y: topLeft.y,
			width: bottomRight.x - topLeft.x,
			height: bottomRight.y - topLeft.y
		};
	}

	isNodeVisible(x: number, y: number, width: number, height: number): boolean {
		const margin = 200;
		const vb = this.getVisibleBounds();
		return !(x + width < vb.x - margin || x > vb.x + vb.width + margin ||
			y + height < vb.y - margin || y > vb.y + vb.height + margin);
	}

	getContainerRect(): DOMRect | null {
		return this._containerRect;
	}

	updateContainerRect(): void {
		if (this._container) {
			this._containerRect = this._container.getBoundingClientRect();
		}
	}

	private _updateTransform(): void {
		const layers = [this._gridLayer, this._edgeLayer, this._nodeLayer, this._overlayLayer];
		const transform = `translate(${this._viewport.x}, ${this._viewport.y}) scale(${this._viewport.zoom})`;
		for (const layer of layers) {
			if (layer) {
				layer.setAttribute('transform', transform);
			}
		}
		this._updateGrid();
		this._updateMinimap();
	}

	private _updateGrid(): void {
		if (!this._gridLayer || !this._containerRect) { return; }

		while (this._gridLayer.firstChild) {
			this._gridLayer.removeChild(this._gridLayer.firstChild);
		}

		const vb = this.getVisibleBounds();
		const gridSize = this._config.gridSize;
		const startX = Math.floor(vb.x / gridSize) * gridSize;
		const startY = Math.floor(vb.y / gridSize) * gridSize;
		const endX = vb.x + vb.width;
		const endY = vb.y + vb.height;

		const step = this._viewport.zoom < 0.5 ? gridSize * 4 :
			this._viewport.zoom < 1 ? gridSize * 2 : gridSize;

		for (let x = startX; x <= endX; x += step) {
			for (let y = startY; y <= endY; y += step) {
				const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
				dot.setAttribute('cx', String(x));
				dot.setAttribute('cy', String(y));
				dot.setAttribute('r', String(this._config.gridDotRadius));
				dot.setAttribute('fill', this._config.gridColor);
				this._gridLayer.appendChild(dot);
			}
		}
	}

	private _createDefs(): void {
		if (!this._defsElement) { return; }

		const arrowMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
		arrowMarker.setAttribute('id', 'edge-arrow');
		arrowMarker.setAttribute('viewBox', '0 0 10 10');
		arrowMarker.setAttribute('refX', '10');
		arrowMarker.setAttribute('refY', '5');
		arrowMarker.setAttribute('markerWidth', '8');
		arrowMarker.setAttribute('markerHeight', '8');
		arrowMarker.setAttribute('orient', 'auto-start-reverse');

		const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
		arrowPath.setAttribute('fill', '#666');
		arrowMarker.appendChild(arrowPath);
		this._defsElement.appendChild(arrowMarker);

		const selectedArrow = arrowMarker.cloneNode(true) as SVGMarkerElement;
		selectedArrow.setAttribute('id', 'edge-arrow-selected');
		(selectedArrow.firstChild as SVGPathElement).setAttribute('fill', '#6ba3e8');
		this._defsElement.appendChild(selectedArrow);
	}

	private _createMinimap(): void {
		if (!this._container) { return; }

		this._minimapContainer = document.createElement('div');
		this._minimapContainer.style.position = 'absolute';
		this._minimapContainer.style.bottom = '12px';
		this._minimapContainer.style.right = '12px';
		this._minimapContainer.style.width = '180px';
		this._minimapContainer.style.height = '120px';
		this._minimapContainer.style.border = '1px solid #333';
		this._minimapContainer.style.borderRadius = '4px';
		this._minimapContainer.style.backgroundColor = 'rgba(20, 20, 20, 0.85)';
		this._minimapContainer.style.overflow = 'hidden';
		this._minimapContainer.style.pointerEvents = 'none';
		this._container.appendChild(this._minimapContainer);
	}

	private _updateMinimap(): void {
		if (!this._minimapContainer) { return; }
		// Minimap rendering delegated to canvasRenderer for full node representation
	}

	private _setupResizeObserver(): void {
		if (!this._container) { return; }

		this._resizeObserver = new ResizeObserver(entries => {
			for (const entry of entries) {
				this._containerRect = entry.target.getBoundingClientRect();
				this._onDidResize.fire({
					width: entry.contentRect.width,
					height: entry.contentRect.height
				});
				this._updateGrid();
			}
		});
		this._resizeObserver.observe(this._container);
		this._containerRect = this._container.getBoundingClientRect();
	}
}
