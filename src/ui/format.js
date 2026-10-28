import { formatNumber, t } from "../i18n/i18n.js";

export function formatClock(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export const formatSignedMs = (ms) =>
    `${ms > 0 ? "+" : ""}${Math.round(ms)} ms`;

/** At most `digits` decimals, trailing zeros dropped: 120.0004 → "120". */
export const formatDecimal = (value, digits) =>
    formatNumber(value, { maximumFractionDigits: digits, useGrouping: false });

/** Value for a number input: locale-free and rounded to two decimals, 120.00000000000001 → 120. */
export const bpmValue = (bpm) => Number(bpm.toFixed(2));

export const trackName = (track) =>
    track.name || t("common.untitledTrack", { number: track.index + 1 });
