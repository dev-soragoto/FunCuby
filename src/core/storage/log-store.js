import { AppError, message } from "../message.js";
const request = (req) =>
    new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
const complete = (tx) =>
    new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () =>
            reject(tx.error || new AppError("errors.log.transaction"));
    });

// One persistent log. IndexedDB allocates sequence numbers across refreshes/tabs.
export class LogStore {
    /** @type {((error: Error) => void) | null} */
    onError = null;
    async open() {
        const req = indexedDB.open("ep1-workbench", 2);
        req.onupgradeneeded = () =>
            req.result.createObjectStore("logs", {
                keyPath: "seq",
                autoIncrement: true,
            });
        req.onblocked = () =>
            this.onError?.(new AppError("errors.log.blocked"));
        this.db = await request(req);
        this.db.onversionchange = () => this.db.close();
        this.queue = Promise.resolve();
    }
    transaction(mode = "readonly") {
        if (!this.db) throw new AppError("errors.log.noIndexedDb");
        return this.db.transaction(["logs"], mode);
    }
    append(record) {
        const task = this.queue
            .catch(() => {})
            .then(async () => {
                const tx = this.transaction("readwrite"),
                    done = complete(tx);
                const { seq, ...fields } = record;
                fields.entryId ||= crypto.randomUUID();
                const req = tx.objectStore("logs").add(fields);
                req.onsuccess = () => {
                    record.seq = req.result;
                    record.entryId = fields.entryId;
                };
                await done;
                return record;
            });
        this.queue = task;
        return task;
    }
    async flush() {
        await this.queue;
    }
    async records({ before = Number.MAX_SAFE_INTEGER, limit = 200 } = {}) {
        const tx = this.transaction(),
            store = tx.objectStore("logs");
        return new Promise((resolve, reject) => {
            const rows = [],
                req = store.openCursor(
                    IDBKeyRange.upperBound(before, true),
                    "prev",
                );
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor || rows.length >= limit) return resolve(rows);
                rows.push(cursor.value);
                cursor.continue();
            };
        });
    }
    clear() {
        const task = this.queue
            .catch(() => {})
            .then(async () => {
                const tx = this.transaction("readwrite"),
                    done = complete(tx);
                tx.objectStore("logs").clear();
                await done;
            });
        this.queue = task;
        return task;
    }
    async exportLogs() {
        await this.flush();
        const parts = [
                JSON.stringify({ schema: "ep1-log", version: 2 }) + "\n",
            ],
            chunks = [];
        let before;
        while (true) {
            const rows = await this.records({ before, limit: 1000 });
            if (!rows.length) break;
            before = rows.at(-1).seq;
            chunks.push(rows.reverse());
        }
        for (const chunk of chunks.reverse())
            for (const row of chunk) parts.push(JSON.stringify(row) + "\n");
        return new Blob(parts, { type: "application/x-ndjson;charset=utf-8" });
    }
}
/** Keeps translatable descriptors intact; anything else is coerced to plain text. */
const text = (value) =>
    typeof value?.key === "string"
        ? message(
              value.key,
              value.params && typeof value.params === "object"
                  ? value.params
                  : {},
          )
        : String(value || "");

/** @param {string} source */
export function parseImport(source) {
    const lines = source.split(/\r?\n/).filter((s) => s.trim());
    if (!lines.length) throw new AppError("errors.log.empty");
    const head = JSON.parse(lines[0]);
    if (head.schema !== "ep1-log" || head.version !== 2)
        throw new AppError("errors.log.schema");
    return lines.slice(1).map((line, i) => {
        const row = JSON.parse(line);
        if (
            !["RX", "TX", "SYS", "ERR"].includes(row.direction) ||
            !Array.isArray(row.bytes) ||
            row.bytes.length > 65536 ||
            row.bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
        )
            throw new AppError("errors.log.badRow", { line: i + 2 });
        return {
            time: String(row.time || ""),
            direction: row.direction,
            bytes: row.bytes,
            events: Array.isArray(row.events) ? row.events : [],
            phase: String(row.phase || ""),
            label: text(row.label),
            message: text(row.message),
            writeMode: String(row.writeMode || ""),
            source: "import",
            originalSource: row.source,
            originalSeq: row.seq,
            packetId: row.packetId,
            txId: String(row.txId || ""),
        };
    });
}
