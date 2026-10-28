import { readMidiFile } from "../../core/midi/midi-file.js";
import { MidiPlayer } from "../../core/midi/player.js";
import { preparePerformance } from "../../core/midi/performance-plan.js";
import {
    bpmForShortestNote,
    retimeSong,
    shortestNoteMs,
} from "../../core/midi/tempo.js";
import { AppError, message } from "../../core/message.js";
import { t } from "../../i18n/i18n.js";
import { byId, el, reportErrors } from "../dom.js";
import {
    bpmValue,
    formatClock as time,
    formatDecimal,
    trackName,
} from "../format.js";

function select(label, options, value) {
    const node = el("select");
    node.setAttribute("aria-label", label);
    for (const [text, optionValue] of options)
        node.add(new Option(text, optionValue));
    node.value = value;
    return node;
}

function numberInput(label, { min, max, step }, value) {
    const node = el("input");
    node.type = "number";
    node.min = String(min);
    node.max = String(max);
    node.step = String(step);
    node.setAttribute("aria-label", label);
    node.value = value;
    return node;
}

function cell(content) {
    const td = el("td");
    td.append(content);
    return td;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => [
    String(i + 1),
    String(i + 1),
]);

/**
 * Play tab: stream a MIDI file to the device.
 * onBusyChange(busy) lets other tabs lock their sends while a song owns the write queue.
 */
export function initPlayPage({
    transport,
    notice,
    isTeachingBusy,
    onBusyChange,
}) {
    const player = new MidiPlayer(transport);
    let song = null,
        settings = [],
        loading = false,
        fileRequest = 0,
        fileName = "",
        durationMs = 0,
        outcome = "",
        positionMs = 0,
        dragging = false;
    let playbackSong = null,
        timeScale = 1,
        automaticTempo = true;
    const report = reportErrors((error) => notice(error, true));
    const showTime = (elapsedMs) => {
        byId("play-elapsed").textContent = time(elapsedMs);
        byId("play-duration").textContent = time(durationMs);
        byId("play-progress").setAttribute(
            "aria-valuetext",
            `${time(elapsedMs)} / ${time(durationMs)}`,
        );
    };
    const showProgress = (elapsedMs = positionMs) => {
        if (dragging) return;
        positionMs = Math.min(durationMs, elapsedMs);
        byId("play-progress").max = durationMs || 1;
        byId("play-progress").value = positionMs;
        showTime(positionMs);
    };

    function refreshDuration() {
        playbackSong = retimeSong(song, byId("play-bpm").value);
        const nextScale = song.initialBpm / playbackSong.initialBpm;
        positionMs *= nextScale / timeScale;
        timeScale = nextScale;
        const events = preparePerformance(playbackSong, settings);
        durationMs = Math.max(
            playbackSong.durationMs,
            events.at(-1)?.timeMs || 0,
        );
        byId("midi-summary").textContent = t("play.summary", {
            file: fileName,
            count: song.tracks.length,
            duration: time(durationMs),
        });
        const shortest = shortestNoteMs(song, settings),
            bpm = formatDecimal(song.initialBpm, 3);
        byId("tempo-info").textContent =
            shortest === null
                ? t("play.tempo.noDurations", { bpm })
                : t("play.tempo.shortest", {
                      bpm,
                      shortest: formatDecimal(shortest * nextScale, 2),
                  });
        byId("play-timing").hidden = true;
        showProgress();
    }

    function calculateTempo() {
        const bpm = bpmForShortestNote(
            song,
            settings,
            byId("tempo-min-note").value,
        );
        byId("play-bpm").value = bpmValue(bpm ?? song.initialBpm);
        automaticTempo = true;
    }

    function tracksChanged() {
        if (automaticTempo) calculateTempo();
        refreshDuration();
        controls();
    }

    function controls() {
        const busy = player.state !== "idle";
        const playable = settings.filter(
            (route, i) => song.tracks[i].noteCount,
        );
        const selected = playable.filter((route) => route.enabled).length;
        byId("select-all-tracks").checked =
            playable.length > 0 && selected === playable.length;
        byId("select-all-tracks").indeterminate =
            selected > 0 && selected < playable.length;
        byId("select-all-tracks").disabled =
            busy || loading || !playable.length;
        byId("play-midi").disabled =
            busy ||
            isTeachingBusy() ||
            loading ||
            !song ||
            transport.state !== "ready" ||
            !settings.some(
                (route, i) => route.enabled && song.tracks[i].noteCount,
            );
        byId("stop-midi").disabled = !busy || player.state === "stopping";
        byId("midi-file").disabled = busy;
        for (const input of document.querySelectorAll(
            "#tempo-controls input, #tempo-controls button",
        ))
            input.disabled = busy || loading || !song;
        byId("play-progress").disabled =
            loading || !durationMs || player.state === "stopping";
        for (const input of byId("midi-tracks").querySelectorAll(
            "input, select",
        ))
            input.disabled =
                busy ||
                input.dataset.empty === "true" ||
                (input.dataset.releaseTrack !== undefined &&
                    !settings[Number(input.dataset.releaseTrack)].noteOff);
        onBusyChange(busy);
        byId("play-status").textContent = statusText();
    }

    function statusText() {
        if (loading) return t("common.readingMidi");
        if (player.state === "stopping") return t("play.status.stopping");
        if (player.state !== "idle") return t("play.status.playing");
        if (transport.state !== "ready") return t("common.connectFirst");
        if (!song) return t("play.chooseFile");
        return t(outcome ? `play.status.${outcome}` : "play.status.ready");
    }

    function seek() {
        if (!dragging) return;
        const target = Number(byId("play-progress").value);
        dragging = false;
        outcome = "";
        showProgress(target);
        if (player.state === "playing") player.seek(target);
        else controls();
    }

    byId("play-progress").addEventListener("pointerdown", () => {
        dragging = true;
    });
    byId("play-progress").addEventListener("input", () => {
        dragging = true;
        showTime(Number(byId("play-progress").value));
    });
    for (const event of ["change", "pointerup", "pointercancel"])
        byId("play-progress").addEventListener(event, seek);

    function trackRow(track) {
        const route = settings[track.index],
            name = trackName(track);
        const label = (key, params) =>
            t(`play.trackLabel.${key}`, { name, ...params });
        const enabled = el("input");
        enabled.type = "checkbox";
        enabled.checked = route.enabled;
        enabled.dataset.empty = String(!track.noteCount);
        enabled.setAttribute("aria-label", label("enabled"));
        enabled.addEventListener(
            "change",
            report(() => {
                route.enabled = enabled.checked;
                tracksChanged();
            }),
        );

        const channel = select(label("channel"), CHANNELS, route.channel);
        channel.addEventListener("change", () => {
            route.channel = Number(channel.value);
        });

        const tone = numberInput(
            label("program"),
            { min: 0, max: 127, step: 1 },
            route.program,
        );
        tone.required = true;
        tone.addEventListener("input", () => {
            route.program = tone.value;
        });
        tone.addEventListener("change", () => tone.reportValidity());

        const format = select(
            label("format"),
            [
                [t("format.timestamp"), "timestamp"],
                [t("format.legacy"), "legacy"],
            ],
            route.format,
        );
        format.addEventListener("change", () => {
            route.format = format.value;
        });

        const mode = select(
            label("mode"),
            [
                [t("play.mode.pressOnly"), "press-only"],
                [t("play.mode.paired"), "paired"],
            ],
            route.noteOff ? "paired" : "press-only",
        );
        mode.addEventListener("change", () => {
            route.noteOff = mode.value === "paired";
            controls();
            report(refreshDuration)();
        });

        // Release settings only apply when the track also sends note-offs.
        const releaseInput = (key, value) => {
            const input = numberInput(
                label(key),
                { min: 0, max: 5000, step: 0.01 },
                value,
            );
            input.dataset.releaseTrack = track.index;
            return input;
        };
        const duration = releaseInput("minDuration", route.minDurationMs);
        duration.addEventListener("input", () => {
            route.minDurationMs = duration.value;
        });
        duration.addEventListener("change", report(refreshDuration));
        const gap = releaseInput("minGap", route.minGapMs);
        gap.addEventListener("input", () => {
            route.minGapMs = gap.value;
        });

        const row = el("tr");
        row.append(
            ...[
                enabled,
                `${track.index + 1}. ${name}`,
                String(track.noteCount),
                channel,
                tone,
                format,
                mode,
                duration,
                gap,
            ].map(cell),
        );
        return row;
    }

    function renderTracks() {
        byId("midi-tracks").replaceChildren(...song.tracks.map(trackRow));
        controls();
    }

    byId("select-all-tracks").addEventListener(
        "change",
        report(() => {
            const checked = byId("select-all-tracks").checked;
            for (const track of song.tracks)
                if (track.noteCount) settings[track.index].enabled = checked;
            byId("midi-tracks")
                .querySelectorAll("input[type=checkbox]")
                .forEach((input, i) => {
                    input.checked = settings[i].enabled;
                });
            tracksChanged();
        }),
    );
    byId("play-bpm").addEventListener(
        "change",
        report(() => {
            automaticTempo = false;
            refreshDuration();
        }),
    );
    byId("tempo-min-note").addEventListener(
        "change",
        report(() => {
            calculateTempo();
            refreshDuration();
        }),
    );
    byId("calculate-bpm").addEventListener(
        "click",
        report(() => {
            calculateTempo();
            refreshDuration();
        }),
    );
    byId("original-bpm").addEventListener(
        "click",
        report(() => {
            byId("play-bpm").value = bpmValue(song.initialBpm);
            automaticTempo = false;
            refreshDuration();
        }),
    );
    byId("midi-file").addEventListener(
        "change",
        report(async () => {
            const file = byId("midi-file").files[0],
                requestId = ++fileRequest;
            if (!file) return;
            loading = true;
            song = null;
            settings = [];
            playbackSong = null;
            timeScale = 1;
            durationMs = 0;
            outcome = "";
            dragging = false;
            byId("midi-tracks").replaceChildren();
            byId("midi-summary").textContent = "";
            byId("tempo-info").textContent = "";
            byId("play-timing").hidden = true;
            showProgress(0);
            controls();
            try {
                const parsed = await readMidiFile(file);
                if (requestId !== fileRequest) return;
                song = parsed;
                settings = song.tracks.map((track) => ({
                    enabled: track.noteCount > 0,
                    channel: 16,
                    program: track.program,
                    format: "timestamp",
                    noteOff: false,
                    minDurationMs: 0,
                    minGapMs: 101,
                }));
                fileName = file.name;
                renderTracks();
                calculateTempo();
                refreshDuration();
                showProgress(0);
                if (!song.events.some((event) => event.on))
                    notice(message("play.noNotes"));
            } finally {
                if (requestId === fileRequest) {
                    loading = false;
                    controls();
                }
            }
        }),
    );
    byId("play-midi").addEventListener(
        "click",
        report(async () => {
            if (!song || loading) return;
            if (isTeachingBusy()) throw new AppError("errors.teachingBusy");
            outcome = "";
            dragging = false;
            refreshDuration();
            if (positionMs >= durationMs) showProgress(0);
            try {
                await player.play(playbackSong, settings, {
                    startMs: positionMs,
                });
            } catch (error) {
                outcome = "failed";
                controls();
                throw error;
            }
        }),
    );
    byId("stop-midi").addEventListener(
        "click",
        report(() => player.stop()),
    );
    player.addEventListener("state", controls);
    player.addEventListener("progress", (event) =>
        showProgress(event.detail.elapsedMs),
    );
    player.addEventListener("timing", ({ detail }) => {
        byId("play-timing").hidden = !detail.skipped;
        byId("play-timing").textContent = t("play.skippedReleases", {
            count: detail.skipped,
        });
    });
    player.addEventListener("ended", (event) => {
        outcome = event.detail.stopped ? "stopped" : "finished";
    });
    transport.addEventListener("status", () => {
        if (transport.state !== "ready")
            player.stop().catch((error) => notice(error, true));
        controls();
    });
    window.addEventListener("pagehide", () => {
        player.stop().catch(() => {});
    });
    controls();
    showProgress();
    return { player, refresh: controls };
}
