/*---------------------------------------------------------------------------------------------
 *  Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * NotebookEdit tool for Power Mode.
 *
 * Reads and writes Jupyter notebook cells (.ipynb files).
 * Reference: Claude Code NotebookEditTool.
 */

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IPowerTool, IToolContext, IToolResult } from '../../common/powerModeTypes.js';
import { definePowerTool } from './powerToolRegistry.js';

interface INotebookCell {
	cell_type: 'code' | 'markdown' | 'raw';
	id?: string;
	source: string | string[];
	metadata?: Record<string, unknown>;
	outputs?: unknown[];
	execution_count?: number | null;
}

interface INotebookContent {
	nbformat: number;
	nbformat_minor: number;
	metadata: Record<string, unknown>;
	cells: INotebookCell[];
}

function cellSource(cell: INotebookCell): string {
	return Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '');
}

function makeId(): string {
	// 8 hex chars — matches nbformat 4.5 cell ID length requirement
	return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}

export function createNotebookEditTool(
	workingDirectory: string,
	fileService: IFileService,
): IPowerTool {
	return definePowerTool(
		'notebook_edit',
		`Replace, insert, or delete a cell in a Jupyter notebook (.ipynb file).

Completely replaces the contents of a specific cell in a Jupyter notebook.
Jupyter notebooks are interactive documents combining code, text, and visualizations.

Parameters:
- notebook_path: Absolute path to the .ipynb file (required)
- cell_number: 0-indexed cell number to act on (required unless inserting at end)
- new_source: New source text for the cell (required unless deleting)
- cell_type: "code" or "markdown" (default: existing cell type, or "code" for insert)
- edit_mode: "replace" (default), "insert" (add new cell after cell_number), or "delete"

Rules:
- notebook_path must be an absolute path
- For insert, new cell is created after cell_number (or at position 0 if cell_number omitted)
- For delete, new_source is ignored`,
		[
			{ name: 'notebook_path', type: 'string', description: 'Absolute path to the .ipynb file', required: true },
			{ name: 'cell_number', type: 'number', description: '0-indexed cell number', required: false },
			{ name: 'new_source', type: 'string', description: 'New source text for the cell', required: false },
			{ name: 'cell_type', type: 'string', description: '"code" or "markdown"', required: false },
			{ name: 'edit_mode', type: 'string', description: '"replace" (default), "insert", or "delete"', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			const notebookPath = args.notebook_path as string;
			const editMode = (args.edit_mode as string) || 'replace';
			const newSource = (args.new_source as string) ?? '';
			const requestedType = args.cell_type as 'code' | 'markdown' | undefined;

			ctx.metadata({ title: `Edit notebook: ${notebookPath.split('/').pop()}` });

			if (!notebookPath || !notebookPath.startsWith('/')) {
				return { title: 'Error', output: 'notebook_path must be an absolute path', metadata: { error: true } };
			}

			if (!notebookPath.endsWith('.ipynb')) {
				return { title: 'Error', output: 'notebook_path must point to a .ipynb file', metadata: { error: true } };
			}

			const uri = URI.file(notebookPath);

			// Read notebook
			let content: INotebookContent;
			try {
				const fileContent = await fileService.readFile(uri);
				const text = fileContent.value.toString();
				content = JSON.parse(text) as INotebookContent;
			} catch (err: any) {
				return { title: 'Error', output: `Failed to read notebook: ${err.message}`, metadata: { error: true } };
			}

			if (!Array.isArray(content.cells)) {
				return { title: 'Error', output: 'Invalid notebook format: missing cells array', metadata: { error: true } };
			}

			const cells = content.cells;
			const cellNumber = (args.cell_number as number) ?? 0;

			if (editMode === 'replace') {
				if (cellNumber < 0 || cellNumber >= cells.length) {
					return { title: 'Error', output: `Cell number ${cellNumber} out of range (notebook has ${cells.length} cells)`, metadata: { error: true } };
				}
				const cell = cells[cellNumber];
				const oldSource = cellSource(cell);
				cell.source = newSource;
				if (requestedType) { cell.cell_type = requestedType; }

				await fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(content, null, 1)));

				return {
					title: `Replaced cell ${cellNumber}`,
					output: `Replaced cell ${cellNumber} (${cell.cell_type})\n\nOld source:\n${oldSource}\n\nNew source:\n${newSource}`,
					metadata: { cellNumber, editMode: 'replace', cellType: cell.cell_type },
				};
			}

			if (editMode === 'insert') {
				const insertAfter = typeof args.cell_number === 'number' ? cellNumber : -1;
				const newCell: INotebookCell = {
					cell_type: requestedType ?? 'code',
					id: makeId(),
					source: newSource,
					metadata: {},
					outputs: [],
					execution_count: null,
				};
				const insertIdx = insertAfter + 1;
				cells.splice(insertIdx, 0, newCell);

				await fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(content, null, 1)));

				return {
					title: `Inserted cell at ${insertIdx}`,
					output: `Inserted ${newCell.cell_type} cell at position ${insertIdx}\n\nSource:\n${newSource}`,
					metadata: { cellNumber: insertIdx, editMode: 'insert', cellType: newCell.cell_type },
				};
			}

			if (editMode === 'delete') {
				if (cellNumber < 0 || cellNumber >= cells.length) {
					return { title: 'Error', output: `Cell number ${cellNumber} out of range (notebook has ${cells.length} cells)`, metadata: { error: true } };
				}
				const [deleted] = cells.splice(cellNumber, 1);
				const deletedSource = cellSource(deleted);

				await fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(content, null, 1)));

				return {
					title: `Deleted cell ${cellNumber}`,
					output: `Deleted ${deleted.cell_type} cell ${cellNumber}\n\nDeleted source:\n${deletedSource}`,
					metadata: { cellNumber, editMode: 'delete', cellType: deleted.cell_type },
				};
			}

			return { title: 'Error', output: `Unknown edit_mode: ${editMode}. Use "replace", "insert", or "delete"`, metadata: { error: true } };
		},
	);
}
