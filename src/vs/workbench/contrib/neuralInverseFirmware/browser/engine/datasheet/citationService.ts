/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Datasheet Citation Service
 *
 * Provides reference-grounded citations for generated firmware code.
 * When the AI generates peripheral configuration code, this service attaches
 * the exact document reference (title, section, page, figure) so developers
 * can trace every register value back to the authoritative source.
 *
 * Citation format: "RM0090 §28.3.4 p.981 — USART BRR register formula"
 */

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';


export const ICitationService = createDecorator<ICitationService>('citationService');

export interface ICitationService {
	readonly _serviceBrand: undefined;

	/**
	 * Get citations relevant to a peripheral + register.
	 * Returns formatted citation strings suitable for code comments.
	 */
	getCitations(peripheral: string, register?: string, field?: string): ICitation[];

	/**
	 * Format a citation as a code comment.
	 */
	formatAsComment(citation: ICitation): string;

	/**
	 * Get all citations from loaded datasheets for a peripheral.
	 */
	getPeripheralReferences(peripheral: string): ICitation[];

	/**
	 * Add a manual citation (from AI datasheet analysis).
	 */
	addCitation(citation: ICitation): void;
}

export interface ICitation {
	/** Source document title (e.g. "RM0090 Reference Manual") */
	document: string;
	/** Section number (e.g. "28.3.4") */
	section?: string;
	/** Page number */
	page?: number;
	/** Figure/table number */
	figure?: string;
	/** Short description of what this citation covers */
	description: string;
	/** Peripheral this applies to */
	peripheral: string;
	/** Register name (if specific) */
	register?: string;
	/** Bit field name (if specific) */
	field?: string;
	/** URL to the online datasheet (if available) */
	url?: string;
}


class CitationServiceImpl extends Disposable implements ICitationService {
	readonly _serviceBrand: undefined;

	private readonly _citations: ICitation[] = [];

	constructor(
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService,
	) {
		super();
	}

	getCitations(peripheral: string, register?: string, field?: string): ICitation[] {
		const periph = peripheral.toUpperCase().replace(/[0-9]+$/, '');

		let results = this._getAllCitations().filter(c =>
			c.peripheral.toUpperCase().replace(/[0-9]+$/, '') === periph
		);

		if (register) {
			const reg = register.toUpperCase();
			results = results.filter(c => !c.register || c.register.toUpperCase() === reg);
		}

		if (field) {
			const f = field.toUpperCase();
			results = results.filter(c => !c.field || c.field.toUpperCase() === f);
		}

		return results;
	}

	formatAsComment(citation: ICitation): string {
		const parts: string[] = [citation.document];
		if (citation.section) parts.push(`§${citation.section}`);
		if (citation.page) parts.push(`p.${citation.page}`);
		if (citation.figure) parts.push(`${citation.figure}`);
		parts.push(`— ${citation.description}`);
		return `// ${parts.join(' ')}`;
	}

	getPeripheralReferences(peripheral: string): ICitation[] {
		const periph = peripheral.toUpperCase().replace(/[0-9]+$/, '');
		return this._getAllCitations().filter(c =>
			c.peripheral.toUpperCase().replace(/[0-9]+$/, '') === periph
		);
	}

	addCitation(citation: ICitation): void {
		this._citations.push(citation);
	}

	private _getAllCitations(): ICitation[] {
		// Merge manually added citations with datasheet-extracted ones
		const fromSession = this._extractSessionCitations();
		return [...this._citations, ...fromSession];
	}

	private _extractSessionCitations(): ICitation[] {
		const session = this._session.session;
		if (!session.isActive) return [];

		const citations: ICitation[] = [];

		// Extract from loaded datasheets
		for (const ds of session.datasheets) {
			// Each register map entry becomes a citation source
			for (const map of session.registerMaps) {
				citations.push({
					document: ds.title,
					peripheral: map.name,
					description: `${map.name} register map (${map.description})`,
				});
			}
		}

		// Extract from timing constraints
		for (const tc of session.timingConstraints ?? []) {
			citations.push({
				document: session.datasheets[0]?.title ?? 'Datasheet',
				peripheral: tc.peripheral,
				description: `${tc.name}: ${tc.conditions ?? ''}`,
				page: tc.datasheetPage,
			});
		}

		return citations;
	}
}

registerSingleton(ICitationService, CitationServiceImpl, InstantiationType.Delayed);
