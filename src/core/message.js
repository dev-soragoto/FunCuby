/**
 * Text produced outside the UI is a translation key plus parameters, never a finished sentence.
 * Descriptors are plain data so they survive IndexedDB, JSONL export and re-import.
 */
export const message = (key, params = {}) => ({ key, params });

export class AppError extends Error {
    constructor(key, params = {}, options) {
        super(key, options);
        this.name = "AppError";
        this.key = key;
        this.params = params;
    }
}

/** A serializable description of any thrown value; browser errors keep their own message. */
export const describe = (error) =>
    error instanceof AppError
        ? message(error.key, error.params)
        : String(error?.message ?? error);
