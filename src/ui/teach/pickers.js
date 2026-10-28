import { DEFAULT_OD, osuHitWindows } from "../../core/teaching/judge.js";
import { t } from "../../i18n/i18n.js";
import { byId, el } from "../dom.js";
import { trackName } from "../format.js";

const DIFFICULTIES = [
    { name: "lenient", od: 0 },
    { name: "easy", od: 2.5 },
    { name: "normal", od: 5 },
    { name: "hard", od: 7.5 },
    { name: "strict", od: 10 },
];

function option(className, input, ...labels) {
    const label = el("label", "", className);
    label.append(input, ...labels);
    return label;
}

/** Renders one checkbox per track, pre-selecting the first track with notes; returns that track. */
export function renderTrackPicker(tracks) {
    const first = tracks.find((track) => track.noteCount);
    byId("teach-tracks").replaceChildren(
        ...tracks.map((track) => {
            const input = el("input");
            input.type = "checkbox";
            input.dataset.track = track.index;
            input.checked = track.index === first?.index;
            input.disabled = !track.noteCount;
            return option(
                "teach-track-option",
                input,
                el("span", `${track.index + 1}. ${trackName(track)}`),
                el(
                    "span",
                    t("teach.tracks.notes", { count: track.noteCount }),
                    "muted",
                ),
            );
        }),
    );
    return first;
}

export const selectedTracks = () =>
    [...byId("teach-tracks").querySelectorAll("input:checked")].map((input) =>
        Number(input.dataset.track),
    );

/** Renders the OD presets and selects the one closest to savedOd. */
export function renderDifficultyPicker(savedOd) {
    const closest = DIFFICULTIES.reduce((best, difficulty) =>
        Math.abs(difficulty.od - savedOd) < Math.abs(best.od - savedOd)
            ? difficulty
            : best,
    );
    byId("teach-difficulties").append(
        ...DIFFICULTIES.map((difficulty) => {
            const windows = osuHitWindows(difficulty.od),
                input = el("input");
            input.type = "radio";
            input.name = "teach-difficulty";
            input.value = difficulty.od;
            input.checked = difficulty === closest;
            return option(
                "teach-difficulty-option",
                input,
                el("span", t(`teach.difficulty.${difficulty.name}`)),
                el(
                    "span",
                    `300 ±${windows.great} ms · 100 ±${windows.ok} ms · 50 ±${windows.meh} ms`,
                    "muted",
                ),
            );
        }),
    );
}

export const selectedDifficulty = () =>
    Number(
        byId("teach-difficulties").querySelector("input:checked")?.value ??
            DEFAULT_OD,
    );
