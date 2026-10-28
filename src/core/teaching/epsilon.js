// Tolerances for floating-point comparisons on the practice timeline.
export const QUARTER_EPSILON = 1e-8;
export const ONSET_EPSILON_MS = 1e-5;
export const CLOCK_EPSILON_MS = 1e-7;

export const sameOnset = (a, b) => Math.abs(a - b) < ONSET_EPSILON_MS;
