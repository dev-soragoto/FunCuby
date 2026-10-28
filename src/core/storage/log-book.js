import { AppError } from "../message.js";
import { parseImport } from "./log-store.js";

export const MEMORY_LIMIT = 500;
const IMPORT_LIMIT_BYTES = 30 * 1024 * 1024;

const jsonl = (rows) => [
    JSON.stringify({ schema: "ep1-log", version: 2 }) + "\n",
    ...rows.map((r) => JSON.stringify(r) + "\n"),
];

/**
 * Packet log: the latest rows stay in memory, every row is appended to IndexedDB when it is available.
 * Events: `record` after a row is added or saved, `capture` when capture is switched,
 * `storage-error` (detail: {error, unsaved}) when persistence is lost.
 */
export class LogBook extends EventTarget {
    constructor(store) {
        super();
        this.store = store;
        this.seq = 0;
        this.persisted = true;
        this.unsaved = 0;
        this.recent = [];
        // Deliberately not persisted: every page load starts with capture disabled.
        this.enabled = false;
        this.opening = null;
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.emit("capture", { enabled });
    }

    storageFailed(error) {
        this.persisted = false;
        this.emit("storage-error", { error, unsaved: this.unsaved });
    }

    record({ direction = "SYS", bytes = [], source = "device", ...fields }) {
        if (!this.enabled) return null;
        const row = {
            entryId: crypto.randomUUID(),
            seq: ++this.seq,
            time: new Date().toISOString(),
            elapsedMs: performance.now(),
            direction,
            source,
            bytes: [...bytes],
            ...fields,
        };
        this.recent.push(row);
        if (this.recent.length > MEMORY_LIMIT) this.recent.shift();
        if (this.persisted)
            this.store
                .append(row)
                .then((saved) => {
                    this.seq = Math.max(this.seq, saved.seq);
                    this.emit("record");
                })
                .catch((error) => {
                    this.unsaved++;
                    this.storageFailed(error);
                });
        else this.unsaved++;
        this.emit("record");
        return row;
    }

    /** Newest first. */
    latest() {
        return this.recent.slice().reverse();
    }

    async ensureStorage() {
        if (this.store.db) return;
        this.opening ??= this.store
            .open()
            .then(() => {
                this.persisted = true;
            })
            .catch((error) => this.storageFailed(error))
            .finally(() => {
                this.opening = null;
            });
        await this.opening;
    }

    /** One page of rows older than `before`, newest first. */
    async page(before) {
        await this.ensureStorage();
        if (this.persisted && this.store.db) {
            await this.store.flush().catch(() => {});
            return this.store.records({ before });
        }
        return this.recent
            .filter((row) => before === undefined || row.seq < before)
            .reverse();
    }

    // Merge a fetched page with the rows on screen. A fresh load also resyncs the memory tail with storage.
    merge(rows, shown, older) {
        const merged = new Map();
        for (const row of older
            ? [...shown, ...rows]
            : [...rows, ...this.recent])
            merged.set(row.entryId, row);
        const all = [...merged.values()].sort((a, b) => b.seq - a.seq);
        const page = older
            ? all.slice(-MEMORY_LIMIT)
            : all.slice(0, MEMORY_LIMIT);
        if (!older) this.recent = page.slice().reverse();
        this.seq = Math.max(this.seq, ...page.map((row) => row.seq));
        return page;
    }

    async flush() {
        if (this.persisted) await this.store.flush();
    }

    async clear() {
        await this.ensureStorage();
        if (this.store.db) await this.store.clear();
        this.recent = [];
        this.unsaved = 0;
    }

    /** @returns {Promise<{blob: Blob, complete: boolean}>} complete is false when only memory rows are exported. */
    async export() {
        await this.ensureStorage();
        if (this.persisted)
            return { blob: await this.store.exportLogs(), complete: true };
        return {
            blob: new Blob(jsonl(this.recent), {
                type: "application/x-ndjson",
            }),
            complete: false,
        };
    }

    /** @param {Blob} file */
    async import(file) {
        await this.ensureStorage();
        if (!this.persisted) throw new AppError("errors.log.importUnavailable");
        if (file.size > IMPORT_LIMIT_BYTES)
            throw new AppError("errors.log.importTooLarge", { limit: 30 });
        for (const row of parseImport(await file.text()))
            await this.store.append(row);
    }
}
