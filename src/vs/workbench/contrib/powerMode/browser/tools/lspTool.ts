/*---------------------------------------------------------------------------------------------
 *  Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * LSP tool for Power Mode — go to definition, find references, hover, document symbols.
 *
 * Reference: Claude Code LSPTool/LSPTool.ts.
 * Uses VS Code's ILanguageFeaturesService + IModelService DI services.
 */

import { Position } from '../../../../../editor/common/core/position.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { URI } from '../../../../../base/common/uri.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IPowerTool, IToolContext, IToolResult } from '../../common/powerModeTypes.js';
import { definePowerTool } from './powerToolRegistry.js';

type LSPOperation =
	| 'goToDefinition'
	| 'findReferences'
	| 'hover'
	| 'documentSymbol';

function formatLocation(loc: { uri: URI; range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }): string {
	return `${loc.uri.fsPath}:${loc.range.startLineNumber}:${loc.range.startColumn}`;
}

export function createLSPTool(
	modelService: IModelService,
	languageFeaturesService: ILanguageFeaturesService,
	fileService: IFileService,
): IPowerTool {
	return definePowerTool(
		'lsp',
		`Perform Language Server Protocol operations on source files.

Available operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all usages of a symbol
- hover: Get type information and docs at a position
- documentSymbol: List all symbols (functions, classes, etc.) in a file

Parameters:
- operation: One of the operations above (required)
- filePath: Absolute path to the source file (required)
- line: Line number (1-based) (required for goToDefinition/findReferences/hover)
- character: Column/character offset (1-based) (required for goToDefinition/findReferences/hover)

Rules:
- The file must be open/accessible in the workspace
- Results reference file paths and line numbers
- Returns empty results if no language server is active for the file type`,
		[
			{ name: 'operation', type: 'string', description: 'goToDefinition | findReferences | hover | documentSymbol', required: true },
			{ name: 'filePath', type: 'string', description: 'Absolute path to the source file', required: true },
			{ name: 'line', type: 'number', description: 'Line number (1-based)', required: false },
			{ name: 'character', type: 'number', description: 'Column offset (1-based)', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			const operation = args.operation as LSPOperation;
			const filePath = args.filePath as string;
			const line = (args.line as number) ?? 1;
			const character = (args.character as number) ?? 1;

			ctx.metadata({ title: `LSP ${operation}: ${filePath.split('/').pop()}:${line}` });

			if (!filePath || !filePath.startsWith('/')) {
				return { title: 'Error', output: 'filePath must be an absolute path', metadata: { error: true } };
			}

			const uri = URI.file(filePath);
			const cts = new CancellationTokenSource();

			try {
				// Ensure model is loaded — open file if not already in model service
				let model = modelService.getModel(uri);
				if (!model) {
					// Read file content and create a transient model
					try {
						const fileContent = await fileService.readFile(uri);
						const text = fileContent.value.toString();
						model = modelService.createModel(text, null, uri);
					} catch (err: any) {
						return { title: 'Error', output: `Cannot read file: ${err.message}`, metadata: { error: true } };
					}
				}

				// 1-based in VS Code
				const pos = new Position(line, character);

				switch (operation) {
					case 'goToDefinition': {
						const providers = languageFeaturesService.definitionProvider.ordered(model);
						if (!providers.length) {
							return { title: 'No definition providers', output: `No definition provider registered for ${model.getLanguageId()}`, metadata: {} };
						}
						const results: string[] = [];
						for (const provider of providers) {
							const defs = await provider.provideDefinition(model, pos, cts.token);
							if (!defs) { continue; }
							const list = Array.isArray(defs) ? defs : [defs];
							for (const d of list) {
								results.push(formatLocation({ uri: 'uri' in d ? (d as any).uri : (d as any).targetUri, range: 'range' in d ? (d as any).range : (d as any).targetRange }));
							}
							if (results.length) { break; }
						}
						if (!results.length) {
							return { title: 'No definition found', output: `No definition found at ${filePath}:${line}:${character}`, metadata: {} };
						}
						return { title: `Definition (${results.length})`, output: results.join('\n'), metadata: { count: results.length } };
					}

					case 'findReferences': {
						const providers = languageFeaturesService.referenceProvider.ordered(model);
						if (!providers.length) {
							return { title: 'No reference providers', output: `No reference provider registered for ${model.getLanguageId()}`, metadata: {} };
						}
						const results: string[] = [];
						for (const provider of providers) {
							const refs = await provider.provideReferences(model, pos, { includeDeclaration: true }, cts.token);
							if (!refs?.length) { continue; }
							for (const r of refs) {
								results.push(`${r.uri.fsPath}:${r.range.startLineNumber}:${r.range.startColumn}`);
							}
							if (results.length) { break; }
						}
						if (!results.length) {
							return { title: 'No references found', output: `No references found at ${filePath}:${line}:${character}`, metadata: {} };
						}
						const MAX = 100;
						const truncated = results.length > MAX;
						const output = results.slice(0, MAX).join('\n') + (truncated ? `\n[${results.length - MAX} more references truncated]` : '');
						return { title: `References (${results.length})`, output, metadata: { count: results.length } };
					}

					case 'hover': {
						const providers = languageFeaturesService.hoverProvider.ordered(model);
						if (!providers.length) {
							return { title: 'No hover providers', output: `No hover provider registered for ${model.getLanguageId()}`, metadata: {} };
						}
						for (const provider of providers) {
							const hover = await provider.provideHover(model, pos, cts.token);
							if (!hover?.contents?.length) { continue; }
							const text = hover.contents.map(c => typeof c === 'string' ? c : c.value).join('\n\n');
							return { title: 'Hover', output: text, metadata: {} };
						}
						return { title: 'No hover info', output: `No hover information at ${filePath}:${line}:${character}`, metadata: {} };
					}

					case 'documentSymbol': {
						const providers = languageFeaturesService.documentSymbolProvider.ordered(model);
						if (!providers.length) {
							return { title: 'No symbol providers', output: `No document symbol provider registered for ${model.getLanguageId()}`, metadata: {} };
						}
						for (const provider of providers) {
							const syms = await provider.provideDocumentSymbols(model, cts.token);
							if (!syms?.length) { continue; }
							const lines = syms.map(s => {
								const range = s.range;
								return `${s.kind === 12 ? 'function' : s.kind === 5 ? 'class' : 'symbol'} ${s.name} — ${filePath}:${range.startLineNumber}:${range.startColumn}`;
							});
							return { title: `Symbols (${lines.length})`, output: lines.join('\n'), metadata: { count: lines.length } };
						}
						return { title: 'No symbols', output: `No symbols found in ${filePath}`, metadata: {} };
					}

					default:
						return { title: 'Error', output: `Unknown operation: ${operation}. Use goToDefinition, findReferences, hover, or documentSymbol`, metadata: { error: true } };
				}
			} finally {
				cts.dispose();
			}
		},
	);
}
