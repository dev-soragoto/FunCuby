import {
    createTeachingScore,
    numberedPitch,
    teachingRange,
} from "../../core/teaching/score.js";
import { AppError, message } from "../../core/message.js";
import { noteName } from "../../core/music.js";
import { QUARTER_EPSILON } from "../../core/teaching/epsilon.js";
import { formatNumber, t } from "../../i18n/i18n.js";
import { byId, el } from "../dom.js";
import { formatDecimal, trackName } from "../format.js";

const PAGE_ROWS = 2;
const HISTORY_LIMIT = 20;

const keyLabel = (key) =>
    t(key.minor ? "teach.key.minor" : "teach.key.major", {
        tonic: key.tonic,
        major: key.major,
    });
const percent = (value) =>
    formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function roundText({ round, result, follow, stopped }) {
    const label = t(
        stopped ? "teach.rounds.stoppedRound" : "teach.rounds.round",
        { round },
    );
    const detail = follow
        ? t("teach.rounds.follow", {
              done: result.completed,
              total: result.total,
              waits: result.waits,
              wrong: result.wrong,
          })
        : t("teach.rounds.rhythm", {
              score: formatNumber(result.score),
              accuracy: percent(result.accuracy),
              combo: result.maxCombo,
          });
    return `${label} · ${detail}`;
}

export function initTeachingScore(notice, peek) {
    let model = null,
        start = 0,
        end = 0,
        page = 0,
        pick = "a",
        locked = false,
        drag = null,
        suppressClick = false;
    let pageBars = 4 * PAGE_ROWS;
    let cells = [],
        blocks = [],
        history = [],
        totalRounds = 0,
        accuracySum = 0,
        best = 0,
        currentBlock = null;
    let emptyMessage = "teach.key.uploadFirst";
    const loopMode = () => byId("teach-loop-mode").value || "count";

    function showKey(quarter) {
        const labels = model.lanes.map((lane) => {
            const key = lane.keyAt(quarter);
            if (!key.explicit) return t("teach.key.unmarked");
            return lane.keys.length > 1
                ? t("teach.key.withChanges", { key: keyLabel(key) })
                : keyLabel(key);
        });
        byId("teach-score-key").textContent = labels.every(
            (label) => label === labels[0],
        )
            ? labels[0]
            : t("teach.key.perTrack", { count: model.lanes.length });
    }

    function selection() {
        byId("teach-pick-a").setAttribute(
            "aria-pressed",
            pick === "a" ? "true" : "false",
        );
        byId("teach-pick-b").setAttribute(
            "aria-pressed",
            pick === "b" ? "true" : "false",
        );
        for (const { node, beat } of cells) {
            const selected =
                beat.quarter >= start - QUARTER_EPSILON &&
                beat.quarter < end - QUARTER_EPSILON;
            node.classList.toggle("selected", selected);
            node.classList.toggle(
                "range-a",
                Math.abs(beat.quarter - start) < QUARTER_EPSILON,
            );
            node.classList.toggle(
                "range-b",
                Math.abs(beat.end - end) < QUARTER_EPSILON,
            );
            node.setAttribute("aria-pressed", String(selected));
        }
        if (!model) return;
        const a = model.locate(start),
            b = model.locate(end);
        byId("teach-loop-range").textContent = t("teach.loop.range", {
            a: t("teach.loop.position", { bar: a.bar, beat: a.beat }),
            b:
                b.beat === null
                    ? t("teach.loop.barEnd", { bar: b.bar })
                    : t("teach.loop.position", { bar: b.bar, beat: b.beat }),
        });
        byId("teach-loop-start").value = a.bar;
        byId("teach-loop-end").value = model.locate(
            Math.max(start, end - 1e-6),
        ).bar;
    }

    function controls(value = locked) {
        locked = value;
        for (const id of [
            "teach-loop-mode",
            "teach-loop-count",
            "teach-loop-gap",
            "teach-loop-start",
            "teach-loop-end",
            "teach-pick-a",
            "teach-pick-b",
            "teach-select-all",
        ])
            byId(id).disabled = locked || !model;
        byId("teach-loop-count").disabled =
            locked || !model || loopMode() !== "count";
        byId("teach-score-prev").disabled = !model || page === 0;
        byId("teach-score-next").disabled =
            !model || (page + 1) * pageBars >= model.barCount;
    }

    function choose(beat) {
        if (locked) return;
        if (pick === "a") {
            start = beat.quarter;
            if (end <= start) end = beat.end;
            pick = "b";
        } else {
            end = beat.end;
            if (start >= end) start = beat.quarter;
            pick = "a";
        }
        selection();
    }

    function noteIndex(notes, quarter) {
        let low = 0,
            high = notes.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (notes[mid].quarter < quarter - QUARTER_EPSILON) low = mid + 1;
            else high = mid;
        }
        return low;
    }

    function beatLayout(beat) {
        const points = [beat.quarter],
            begin = noteIndex(model.notes, beat.quarter),
            limit = noteIndex(model.notes, beat.end);
        for (let i = begin; i < limit; i++) {
            const quarter = model.notes[i].quarter;
            if (quarter > points.at(-1) + QUARTER_EPSILON) points.push(quarter);
        }
        const columns = points
            .map(
                (quarter, i) =>
                    `minmax(0, ${(points[i + 1] ?? beat.end) - quarter}fr)`,
            )
            .join(" ");
        return { points, columns };
    }

    function measurePageSize() {
        const sheet = byId("teach-score-sheet");
        if (
            typeof getComputedStyle !== "function" ||
            sheet.getClientRects?.().length === 0
        )
            return false;
        const columns = (
            getComputedStyle(sheet).gridTemplateColumns.match(/[\d.]+px/g) || []
        ).filter((width) => parseFloat(width) > 0).length;
        if (!columns || columns * PAGE_ROWS === pageBars) return false;
        const firstBar = page * pageBars;
        pageBars = columns * PAGE_ROWS;
        page = Math.floor(firstBar / pageBars);
        return true;
    }

    function draw() {
        measurePageSize();
        cells = [];
        blocks = [];
        currentBlock = null;
        const sheet = byId("teach-score-sheet");
        sheet.replaceChildren();
        sheet.classList.toggle(
            "multi-track",
            !!model && model.lanes.length > 1,
        );
        if (!model) {
            byId("teach-score-key").textContent = t(emptyMessage);
            byId("teach-score-page").textContent = t("teach.score.empty");
            byId("teach-loop-range").textContent = t("teach.loop.rangeEmpty");
            byId("teach-loop-start").value = 1;
            byId("teach-loop-end").value = 1;
            controls();
            return;
        }
        page = Math.min(page, Math.ceil(model.barCount / pageBars) - 1);
        showKey(model.barAt(page * pageBars + 1).start);
        for (
            let number = page * pageBars + 1;
            number <= Math.min(model.barCount, (page + 1) * pageBars);
            number++
        ) {
            const bar = model.barAt(number),
                block = el("div", "", "score-bar");
            block.append(
                el(
                    "div",
                    t("teach.score.bar", {
                        bar: number,
                        meter: `${bar.numerator}/${bar.denominator}`,
                    }),
                    "score-bar-heading",
                ),
            );
            const layouts = bar.beats.map(beatLayout);
            for (const lane of model.lanes) {
                const row = el("div", "", "score-track"),
                    barKey = lane.keyAt(bar.start),
                    name = trackName(lane);
                const heading = el(
                    "div",
                    `${lane.index + 1}. ${name} · 1=${barKey.major}${barKey.minor ? ` / 6=${barKey.tonic}` : ""}`,
                    "score-track-heading",
                );
                heading.title = `${name} · ${keyLabel(barKey)}`;
                row.append(heading);
                const beats = el("div", "", "score-beats");
                beats.style.gridTemplateColumns = `repeat(${bar.beats.length}, minmax(32px, 1fr))`;
                for (const [beatIndex, beat] of bar.beats.entries()) {
                    const cell = el("div", "", "score-beat");
                    cell.setAttribute("role", "button");
                    cell.setAttribute("tabindex", "0");
                    cell.setAttribute(
                        "aria-label",
                        t("teach.score.beatLabel", {
                            track: name,
                            position: t("teach.loop.position", {
                                bar: number,
                                beat: beat.number,
                            }),
                        }),
                    );
                    cell.append(
                        el("span", String(beat.number), "score-beat-number"),
                    );
                    const content = el("div", "", "score-events"),
                        layout = layouts[beatIndex];
                    content.style.gridTemplateColumns = layout.columns;
                    const begin = noteIndex(lane.notes, beat.quarter),
                        limit = noteIndex(lane.notes, beat.end);
                    for (const key of lane.keys) {
                        if (
                            key.quarter > bar.start + QUARTER_EPSILON &&
                            key.quarter >= beat.quarter - QUARTER_EPSILON &&
                            key.quarter < beat.end - QUARTER_EPSILON
                        ) {
                            const change = el(
                                "span",
                                key.minor ? `6=${key.tonic}` : `1=${key.major}`,
                                "score-key-change",
                            );
                            change.title = keyLabel(key);
                            cell.append(change);
                        }
                    }
                    let i = begin;
                    for (const quarter of layout.points) {
                        const group = el("div", "", "score-chord");
                        while (
                            i < limit &&
                            Math.abs(lane.notes[i].quarter - quarter) <
                                QUARTER_EPSILON
                        ) {
                            const note = lane.notes[i++],
                                key = lane.keyAt(quarter),
                                pitch = numberedPitch(note.note, key),
                                token = el("span", "", "score-note");
                            token.title = t("teach.score.noteTitle", {
                                track: name,
                                note: noteName(note.note),
                                key: keyLabel(key),
                                beat: formatDecimal(
                                    (quarter - beat.quarter) /
                                        (beat.end - beat.quarter) +
                                        beat.number,
                                    3,
                                ),
                            });
                            token.append(
                                el(
                                    "span",
                                    pitch.octave > 0
                                        ? "·".repeat(pitch.octave)
                                        : "",
                                    "score-octave",
                                ),
                                el("span", pitch.digit, "score-digit"),
                                el(
                                    "span",
                                    pitch.octave < 0
                                        ? "·".repeat(-pitch.octave)
                                        : "",
                                    "score-octave",
                                ),
                            );
                            token.addEventListener("click", () =>
                                peek(note.note),
                            );
                            group.append(token);
                        }
                        if (!group.childElementCount)
                            group.append(
                                el(
                                    "span",
                                    (lane.maxEnds[i - 1] ?? -Infinity) >
                                        quarter + QUARTER_EPSILON
                                        ? "—"
                                        : "0",
                                    "score-rest",
                                ),
                            );
                        content.append(group);
                    }
                    cell.append(content);
                    cells.push({ node: cell, beat });
                    beats.append(cell);
                    cell.addEventListener("click", () => {
                        if (suppressClick) {
                            suppressClick = false;
                            return;
                        }
                        choose(beat);
                    });
                    cell.addEventListener("keydown", (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            choose(beat);
                        }
                    });
                    cell.addEventListener("pointerdown", (event) => {
                        if (!locked && event.button === 0) {
                            suppressClick = false;
                            drag = { anchor: beat, moved: false };
                        }
                    });
                    cell.addEventListener("pointerenter", () => extend(beat));
                }
                row.append(beats);
                block.append(row);
            }
            blocks.push({ node: block, bar });
            sheet.append(block);
        }
        byId("teach-score-page").textContent = t("teach.score.page", {
            page: page + 1,
            pages: Math.ceil(model.barCount / pageBars),
            bars: t("teach.score.bars", { count: model.barCount }),
            tracks: t("teach.score.tracks", { count: model.lanes.length }),
            perRow: pageBars / PAGE_ROWS,
        });
        selection();
        controls();
    }

    function extend(beat) {
        if (
            !drag ||
            locked ||
            Math.abs(beat.quarter - drag.anchor.quarter) < QUARTER_EPSILON
        )
            return;
        drag.moved = true;
        start = Math.min(drag.anchor.quarter, beat.quarter);
        end = Math.max(drag.anchor.end, beat.end);
        selection();
    }

    document.addEventListener("pointermove", (event) => {
        if (!drag || locked || event.pointerType !== "touch") return;
        const target = document.elementFromPoint?.(
            event.clientX,
            event.clientY,
        );
        const cell = cells.find(
            (cell) => cell.node === target || cell.node.contains?.(target),
        );
        if (cell) extend(cell.beat);
    });
    document.addEventListener("pointerup", () => {
        if (drag?.moved) suppressClick = true;
        drag = null;
    });
    document.addEventListener("pointercancel", () => {
        drag = null;
        suppressClick = false;
    });
    byId("teach-pick-a").addEventListener("click", () => {
        if (!locked) {
            pick = "a";
            selection();
        }
    });
    byId("teach-pick-b").addEventListener("click", () => {
        if (!locked) {
            pick = "b";
            selection();
        }
    });
    byId("teach-select-all").addEventListener("click", () => {
        if (!locked && model) {
            start = 0;
            end = model.endQuarter;
            selection();
        }
    });
    byId("teach-score-prev").addEventListener("click", () => {
        if (model && page > 0) {
            page--;
            draw();
        }
    });
    byId("teach-score-next").addEventListener("click", () => {
        if (model && (page + 1) * pageBars < model.barCount) {
            page++;
            draw();
        }
    });
    for (const id of ["teach-loop-start", "teach-loop-end"])
        byId(id).addEventListener("change", () => {
            if (locked || !model) return;
            const a = Number(byId("teach-loop-start").value),
                b = Number(byId("teach-loop-end").value);
            if (
                !Number.isInteger(a) ||
                !Number.isInteger(b) ||
                a < 1 ||
                b < a ||
                b > model.barCount
            ) {
                notice(message("errors.invalidBars"), true);
                selection();
                return;
            }
            start = model.barAt(a).start;
            end = model.barAt(b).end;
            page = Math.floor((a - 1) / pageBars);
            draw();
        });
    byId("teach-loop-mode").addEventListener("change", () => controls());

    function refresh(song, tracks, bpm, preserve = false) {
        const previousStart = start,
            previousEnd = end,
            previousModel = model;
        const selected = Array.isArray(tracks) ? tracks : [tracks];
        const fullRange =
            previousModel &&
            start === 0 &&
            Math.abs(end - previousModel.endQuarter) < QUARTER_EPSILON;
        model =
            song && selected.length
                ? createTeachingScore(song, selected, bpm)
                : null;
        emptyMessage = song
            ? "teach.key.chooseTracks"
            : "teach.key.uploadFirst";
        const keepRange = preserve && previousModel && !fullRange;
        start = keepRange ? Math.min(previousStart, model?.endQuarter || 0) : 0;
        end = keepRange
            ? Math.min(previousEnd, model?.endQuarter || 0)
            : model?.endQuarter || 0;
        if (start >= end) start = 0;
        page =
            preserve && model
                ? Math.min(page, Math.ceil(model.barCount / pageBars) - 1)
                : 0;
        byId("teach-loop-start").max = model?.barCount || 1;
        byId("teach-loop-end").max = model?.barCount || 1;
        draw();
    }

    function plan() {
        if (!model) throw new AppError("errors.uploadAndChoose");
        const count =
            loopMode() === "infinite"
                ? Infinity
                : Number(byId("teach-loop-count").value);
        if (
            count !== Infinity &&
            (!Number.isInteger(count) || count < 1 || count > 999)
        )
            throw new AppError("errors.integer", {
                field: message("fields.rounds"),
                min: 1,
                max: 999,
            });
        const gapBars = Number(byId("teach-loop-gap").value || 0);
        if (![0, 1, 2].includes(gapBars))
            throw new AppError("errors.invalidGap");
        return {
            ...teachingRange(model, start, end),
            count,
            gapMs: model.gapMs(start, gapBars),
            trackNames: model.lanes.map(
                (lane) => `${lane.index + 1}. ${trackName(lane)}`,
            ),
        };
    }

    function position(sourceMs) {
        if (!model) return;
        const quarter = model.grid.quarterAt(sourceMs),
            location = model.locate(Math.max(0, quarter));
        const nextPage = Math.floor((location.bar - 1) / pageBars);
        if (nextPage !== page && locked) {
            page = nextPage;
            draw();
        }
        showKey(quarter);
        for (const cell of cells) {
            const active =
                quarter >= cell.beat.quarter - QUARTER_EPSILON &&
                quarter < cell.beat.end - QUARTER_EPSILON;
            cell.node.classList.toggle("current", active);
        }
        const current = blocks.find(
            (block) => block.bar.number === location.bar,
        )?.node;
        if (locked && current && current !== currentBlock) {
            const sheet = byId("teach-score-sheet"),
                bounds = sheet.getBoundingClientRect?.(),
                target = current.getBoundingClientRect?.();
            if (bounds && target) {
                if (target.height > bounds.height)
                    sheet.scrollTop += target.top - bounds.top;
                else if (target.bottom > bounds.bottom)
                    sheet.scrollTop += target.bottom - bounds.bottom + 8;
                else if (target.top < bounds.top)
                    sheet.scrollTop -= bounds.top - target.top + 8;
            }
        }
        currentBlock = current;
    }

    function resetHistory() {
        history = [];
        totalRounds = 0;
        accuracySum = 0;
        best = 0;
        byId("teach-round-results").hidden = true;
        byId("teach-round-history").replaceChildren();
    }

    function recordRound(round, result, follow, stopped) {
        const accuracy = follow
            ? result.total
                ? (result.completed / result.total) * 100
                : 0
            : result.accuracy;
        totalRounds++;
        accuracySum += accuracy;
        best = Math.max(best, accuracy);
        history.unshift({ round, result, follow, stopped });
        history = history.slice(0, HISTORY_LIMIT);
        byId("teach-round-results").hidden = false;
        const summary = t(
            follow
                ? "teach.rounds.summaryFollow"
                : "teach.rounds.summaryRhythm",
            {
                count: totalRounds,
                best: percent(best),
                average: percent(accuracySum / totalRounds),
            },
        );
        byId("teach-round-summary").textContent =
            totalRounds > HISTORY_LIMIT
                ? `${summary} · ${t("teach.rounds.recent", { count: HISTORY_LIMIT })}`
                : summary;
        byId("teach-round-history").replaceChildren(
            ...history.map((item) => el("div", roundText(item))),
        );
    }

    if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(() => {
            if (measurePageSize()) draw();
        });
        observer.observe(byId("teach-score-sheet"));
    }
    draw();
    return { refresh, plan, position, controls, resetHistory, recordRound };
}
