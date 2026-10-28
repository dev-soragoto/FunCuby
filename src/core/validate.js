import { AppError, message } from "./message.js";

// `field` is an i18n key under "fields." naming the value in the error.
export function integer(value, min, max, field = "value") {
    const n = typeof value === "string" && !value.trim() ? NaN : Number(value);
    if (!Number.isInteger(n) || n < min || n > max)
        throw new AppError("errors.integer", {
            field: message(`fields.${field}`),
            min,
            max,
        });
    return n;
}
