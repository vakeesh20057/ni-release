/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Persistent Context Store — IndexedDB-backed persistence for search indexes.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';

const DB_NAME = 'ni-context-search';
const DB_VERSION = 1;
const STORE_BM25 = 'bm25-index';
const STORE_TRIGRAM = 'trigram-index';
const STORE_EMBEDDINGS = 'embeddings';

export interface IStoredChunk {
	id: string; // workspace_id:file_path:chunk_index
	filePath: string;
	contentHash: string;
	content: string;
	startLine: number;
	endLine: number;
	symbolName?: string;
	terms: string[]; // tokenized terms for BM25
	updatedAt: number;
}

export interface IStoredEmbedding {
	id: string;
	filePath: string;
	contentHash: string;
	vector: Float32Array;
	updatedAt: number;
}

export interface IStoredTrigram {
	trigram: string;
	entries: { id: string; filePath: string; symbolName?: string }[];
}

export interface IPersistentContextStore {
	readonly _serviceBrand: undefined;

	initialize(workspaceId: string): Promise<void>;

	// BM25 Index
	putChunks(chunks: IStoredChunk[]): Promise<void>;
	getChunksByFile(filePath: string): Promise<IStoredChunk[]>;
	getAllChunks(): Promise<IStoredChunk[]>;
	deleteChunksByFile(filePath: string): Promise<void>;

	// Trigrams
	putTrigrams(trigrams: IStoredTrigram[]): Promise<void>;
	getTrigramEntries(trigram: string): Promise<IStoredTrigram | undefined>;

	// Embeddings
	putEmbeddings(embeddings: IStoredEmbedding[]): Promise<void>;
	getEmbedding(id: string): Promise<IStoredEmbedding | undefined>;
	getAllEmbeddings(): Promise<IStoredEmbedding[]>;

	// Maintenance
	clearAll(): Promise<void>;
	getFileContentHash(filePath: string): Promise<string | undefined>;
}

export const IPersistentContextStore = createDecorator<IPersistentContextStore>('persistentContextStore');

class PersistentContextStore extends Disposable implements IPersistentContextStore {
	readonly _serviceBrand: undefined;

	private _db: IDBDatabase | null = null;
	private _workspaceId = '';

	async initialize(workspaceId: string): Promise<void> {
		this._workspaceId = workspaceId;
		this._db = await this._openDB();
	}

	private _openDB(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(`${DB_NAME}-${this._workspaceId}`, DB_VERSION);
			req.onupgradeneeded = (e) => {
				const db = (e.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(STORE_BM25)) {
					const store = db.createObjectStore(STORE_BM25, { keyPath: 'id' });
					store.createIndex('filePath', 'filePath', { unique: false });
					store.createIndex('contentHash', 'contentHash', { unique: false });
				}
				if (!db.objectStoreNames.contains(STORE_TRIGRAM)) {
					db.createObjectStore(STORE_TRIGRAM, { keyPath: 'trigram' });
				}
				if (!db.objectStoreNames.contains(STORE_EMBEDDINGS)) {
					const eStore = db.createObjectStore(STORE_EMBEDDINGS, { keyPath: 'id' });
					eStore.createIndex('filePath', 'filePath', { unique: false });
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	async putChunks(chunks: IStoredChunk[]): Promise<void> {
		const tx = this._tx(STORE_BM25, 'readwrite');
		const store = tx.objectStore(STORE_BM25);
		for (const chunk of chunks) {
			store.put(chunk);
		}
		await this._complete(tx);
	}

	async getChunksByFile(filePath: string): Promise<IStoredChunk[]> {
		const tx = this._tx(STORE_BM25, 'readonly');
		const index = tx.objectStore(STORE_BM25).index('filePath');
		return this._getAllFromIndex(index, filePath);
	}

	async getAllChunks(): Promise<IStoredChunk[]> {
		const tx = this._tx(STORE_BM25, 'readonly');
		const store = tx.objectStore(STORE_BM25);
		return this._getAll(store);
	}

	async deleteChunksByFile(filePath: string): Promise<void> {
		const existing = await this.getChunksByFile(filePath);
		const tx = this._tx(STORE_BM25, 'readwrite');
		const store = tx.objectStore(STORE_BM25);
		for (const chunk of existing) {
			store.delete(chunk.id);
		}
		await this._complete(tx);
	}

	async putTrigrams(trigrams: IStoredTrigram[]): Promise<void> {
		const tx = this._tx(STORE_TRIGRAM, 'readwrite');
		const store = tx.objectStore(STORE_TRIGRAM);
		for (const t of trigrams) {
			store.put(t);
		}
		await this._complete(tx);
	}

	async getTrigramEntries(trigram: string): Promise<IStoredTrigram | undefined> {
		const tx = this._tx(STORE_TRIGRAM, 'readonly');
		const store = tx.objectStore(STORE_TRIGRAM);
		return this._get(store, trigram);
	}

	async putEmbeddings(embeddings: IStoredEmbedding[]): Promise<void> {
		const tx = this._tx(STORE_EMBEDDINGS, 'readwrite');
		const store = tx.objectStore(STORE_EMBEDDINGS);
		for (const e of embeddings) {
			store.put(e);
		}
		await this._complete(tx);
	}

	async getEmbedding(id: string): Promise<IStoredEmbedding | undefined> {
		const tx = this._tx(STORE_EMBEDDINGS, 'readonly');
		const store = tx.objectStore(STORE_EMBEDDINGS);
		return this._get(store, id);
	}

	async getAllEmbeddings(): Promise<IStoredEmbedding[]> {
		const tx = this._tx(STORE_EMBEDDINGS, 'readonly');
		const store = tx.objectStore(STORE_EMBEDDINGS);
		return this._getAll(store);
	}

	async clearAll(): Promise<void> {
		for (const storeName of [STORE_BM25, STORE_TRIGRAM, STORE_EMBEDDINGS]) {
			const tx = this._tx(storeName, 'readwrite');
			tx.objectStore(storeName).clear();
			await this._complete(tx);
		}
	}

	async getFileContentHash(filePath: string): Promise<string | undefined> {
		const chunks = await this.getChunksByFile(filePath);
		return chunks.length > 0 ? chunks[0].contentHash : undefined;
	}

	private _tx(storeName: string, mode: IDBTransactionMode): IDBTransaction {
		if (!this._db) { throw new Error('DB not initialized'); }
		return this._db.transaction(storeName, mode);
	}

	private _complete(tx: IDBTransaction): Promise<void> {
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	private _get<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
		return new Promise((resolve, reject) => {
			const req = store.get(key);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	private _getAll<T>(store: IDBObjectStore): Promise<T[]> {
		return new Promise((resolve, reject) => {
			const req = store.getAll();
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	private _getAllFromIndex<T>(index: IDBIndex, key: string): Promise<T[]> {
		return new Promise((resolve, reject) => {
			const req = index.getAll(key);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
}

registerSingleton(IPersistentContextStore, PersistentContextStore, InstantiationType.Delayed);
