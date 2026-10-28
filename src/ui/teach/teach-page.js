import { readMidiFile } from "../../core/midi/midi-file.js";
import { noteName } from "../../core/music.js";
import {
    CLOCK_EPSILON_MS,
    QUARTER_EPSILON,
    sameOnset,
} from "../../core/teaching/epsilon.js";
import { FollowPractice } from "../../core/teaching/follow-practice.js";
import {
    DEFAULT_OD,
    HIT_WINDOW,
    TeachingJudge,
} from "../../core/teaching/judge.js";
import { TeachingMetronome } from "../../core/teaching/metronome.js";
import {
    calibrationOffset,
    colorTeachingNotes,
} from "../../core/teaching/notes.js";
import { AppError, message } from "../../core/message.js";
import { getLocale, t } from "../../i18n/i18n.js";
import { byId, reportErrors } from "../dom.js";
import {
    bpmValue,
    formatClock,
    formatDecimal,
    formatSignedMs,
} from "../format.js";
import {
    renderDifficultyPicker,
    renderTrackPicker,
    selectedDifficulty,
    selectedTracks,
} from "./pickers.js";
import {
    hideResults,
    resetScore,
    showFollowRound,
    showResults,
    showScore,
} from "./results-view.js";
import { initTeachingScore } from "./score-view.js";
import { createStage } from "./stage-view.js";

const CALIBRATION_TAPS = 8;
const CALIBRATION_INTERVAL_MS = 1100;
const CALIBRATION_WINDOW_MS = 500;
const COUNT_IN_MS = 3000;
const RESUME_COUNTDOWN_MS = 3000;

const PHASES_WITH_STATUS = [
    "preparing",
    "calibrating",
    "paused",
    "waiting",
    "playing",
];
const HIT_FEEDBACK = {
    Miss: "miss",
    Wrong: "wrong",
    Done: "done",
    Armed: "done",
    Calibrated: "sampled",
};

const LOCKED_WHILE_RUNNING = [
    "teach-mode",
    "teach-lead",
    "teach-first-note",
    "teach-apply-map",
    "teach-offset",
    "teach-apply-offset",
    "teach-reset-offset",
];

/**
 * Practice tab: rhythm-game and follow modes against the device keyboard.
 * onStateChange() runs after every control refresh so other tabs can re-check isBusy.
 *
 * Phases: idle → preparing (awaiting audio) → playing ⇄ paused → idle.
 * Follow mode adds waiting (clock frozen until the current chord is held). Latency calibration
 * runs idle → preparing → calibrating → idle. `session` exists from playing/calibrating until idle.
 */
export function initTeachPage({
    transport,
    player,
    notice,
    preferences,
    getOffset,
    setOffset,
    onStateChange,
}) {
    let song = null,
        fileName = "",
        loading = false,
        fileRequest = 0,
        phase = "idle",
        session = null;
    let mapping = false,
        frame = null,
        timingOffset = 0,
        feedbackUntil = 0,
        displayedOffset = null;
    const held = new Map();
    const stage = createStage(getOffset);
    const metronome = new TeachingMetronome(() =>
        pause(t("teach.status.metronomeSuspended")),
    );
    const scoreView = initTeachingScore(notice, (note) => stage.peek(note));
    const report = reportErrors((error) => notice(error, true));

    const active = () =>
        ["playing", "waiting", "calibrating", "preparing"].includes(phase);
    const locked = () => phase !== "idle";
    const heldPitches = () => new Set(held.values());
    const isHeld = (note) => [...held.values()].includes(note);
    const scorer = () => session.practice || session.judge;
    const isFollowMode = () => byId("teach-mode").value === "follow";

    function number(id, field) {
        const input = byId(id);
        if (
            !input.reportValidity() ||
            input.value === "" ||
            !Number.isFinite(Number(input.value))
        )
            throw new AppError("errors.invalidNumber", {
                field: message(`fields.${field}`),
            });
        return Number(input.value);
    }

    function savedNumber(name, fallback, min, max) {
        const value = preferences.get(name),
            parsed = Number(value);
        return value !== null &&
            Number.isFinite(parsed) &&
            parsed >= min &&
            parsed <= max
            ? parsed
            : fallback;
    }

    function discardResults() {
        hideResults();
        scoreView.resetHistory();
    }

    function feedback(text, until = performance.now() + 800) {
        byId("teach-feedback").textContent = text;
        feedbackUntil = until;
    }

    function statusText({ ready, playing, tracks }) {
        if (loading) return t("common.readingMidi");
        if (PHASES_WITH_STATUS.includes(phase))
            return t(`teach.status.${phase}`);
        if (mapping) return t("teach.status.pressFirstKey");
        if (!ready) return t("teach.status.connect");
        if (playing) return t("teach.status.stopPlayback");
        if (!song) return t("teach.status.noSong");
        return t(
            tracks.length ? "teach.status.ready" : "teach.status.noTracks",
        );
    }

    function controls(status) {
        const frozen = locked(),
            ready = transport.state === "ready",
            playing = player.state !== "idle",
            tracks = selectedTracks();
        byId("teach-track-count").textContent = tracks.length
            ? t("teach.tracks.selected", { count: tracks.length })
            : t("teach.tracks.none");
        byId("teach-start").disabled =
            active() ||
            phase === "paused" ||
            loading ||
            !song ||
            !tracks.length ||
            !ready ||
            playing;
        byId("teach-pause").disabled =
            !["playing", "waiting", "paused"].includes(phase) ||
            !ready ||
            playing;
        byId("teach-pause").textContent = t(
            phase === "paused" ? "teach.resume" : "teach.pause",
        );
        byId("teach-stop").disabled = !frozen && !mapping;
        byId("teach-stop").textContent = t(
            phase === "calibrating" || mapping
                ? "teach.cancelCalibration"
                : "teach.stop",
        );
        byId("teach-file").disabled = frozen;
        for (const id of ["teach-track-picker", "teach-bpm"])
            byId(id).disabled = frozen || loading || !song;
        for (const id of LOCKED_WHILE_RUNNING) byId(id).disabled = frozen;
        byId("teach-difficulty-picker").disabled = frozen || isFollowMode();
        byId("teach-difficulty-status").hidden = !isFollowMode();
        byId("teach-round").hidden = !session?.loop;
        scoreView.controls(frozen || loading);
        byId("teach-map").disabled = frozen || !ready || playing;
        byId("teach-map").textContent = t(
            mapping ? "teach.mapping.cancel" : "device.calibration.start",
        );
        byId("teach-calibrate").disabled =
            frozen || !ready || playing || loading;
        byId("teach-metronome").disabled = phase === "preparing";
        byId("teach-status").textContent =
            status || statusText({ ready, playing, tracks });
        onStateChange();
    }

    function mappingChanged() {
        const offset = getOffset();
        if (offset !== displayedOffset) {
            displayedOffset = offset;
            byId("teach-first-note").value = 60 + offset;
            byId("teach-mapping").textContent = t("teach.mapping.current", {
                note: noteName(60 + offset),
                pitch: 60 + offset,
            });
            stage.relabel(offset);
        }
        stage.showHeld(heldPitches());
    }

    function score() {
        if (!session?.judge && !session?.practice) return;
        showScore({
            result: scorer().result,
            follow: !!session.practice,
        });
        if (session.practice) showFollowRound(session.loop);
    }

    function showHit(hit, animate = true) {
        if (!hit) return;
        if (hit.id !== undefined) stage.removeRing(hit.id);
        if (animate) stage.flash(hit);
        feedback(
            HIT_FEEDBACK[hit.grade]
                ? t(`teach.feedback.${HIT_FEEDBACK[hit.grade]}`)
                : hit.grade,
        );
    }

    // ---- clock -------------------------------------------------------------------------------

    function elapsed(now = performance.now()) {
        if (!session) return 0;
        if (
            phase === "paused" ||
            phase === "waiting" ||
            (session.resumeAt && now < session.resumeAt)
        )
            return session.pausedMs;
        return now - session.origin;
    }

    function cancelFrame() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
    }

    function scheduleAudio(skipCurrent = false) {
        metronome.stop();
        const silent =
            !session ||
            !active() ||
            phase === "waiting" ||
            session.practice?.waiting ||
            !byId("teach-metronome").checked ||
            !metronome.context;
        if (silent) return;
        metronome.start({
            origin: session.origin,
            grid: session.grid,
            startMs:
                (session.resumeAt ? session.pausedMs : elapsed()) +
                (skipCurrent ? 0.01 : 0),
            endMs: () =>
                Math.min(
                    session.endMs - (session.mode === "lesson" ? 0.01 : 0),
                    session.practice?.current?.timeMs ?? Infinity,
                ),
        });
    }

    // Follow mode moves the clock itself: it freezes on an unheld chord and jumps ahead on early completion.
    function advanceFollow(now, pitches = heldPitches(), allowEarly = false) {
        const wasWaiting = phase === "waiting";
        const before = elapsed(now),
            result = session.practice.advance(before, pitches, allowEarly);
        const jumped = result.position > before + CLOCK_EPSILON_MS;
        result.results.forEach((hit) =>
            showHit(hit, !session.pressFeedback.has(hit.id)),
        );
        if (result.waiting) {
            session.pausedMs = result.position;
            if (!wasWaiting) {
                phase = "waiting";
                metronome.stop();
                controls();
            }
        } else if (wasWaiting || jumped) {
            session.origin = now - result.position;
            phase = "playing";
            controls();
            scheduleAudio(true);
        }
        if (jumped && result.results.length)
            feedback(t("teach.feedback.early"));
        return result.position;
    }

    // Advances the running mode to raw; returns the effective position, or null once the run has ended.
    function advanceClock(now, raw) {
        if (session.mode === "calibration") {
            for (const note of session.notes)
                if (!note.grade && raw > note.timeMs + CALIBRATION_WINDOW_MS)
                    note.grade = "Miss";
            if (raw <= session.endMs) return raw;
            finishCalibration();
            return null;
        }
        if (session.practice) {
            raw = advanceFollow(now);
            score();
            if (!(session.practice.complete && raw >= session.deadlineMs))
                return raw;
        } else {
            session.judge
                .advance(raw - timingOffset)
                .forEach((hit) => showHit(hit));
            score();
            if (raw <= session.deadlineMs) return raw;
        }
        if (session.practice) completeFollowRound();
        else finish(false);
        return null;
    }

    function tick() {
        frame = null;
        if (!session || !active() || phase === "preparing") return;
        const now = performance.now();
        let raw = elapsed(now);
        if (!(session.resumeAt && now < session.resumeAt)) {
            session.resumeAt = null;
            raw = advanceClock(now, raw);
            if (raw === null) return;
        }
        render(now, raw);
        frame = requestAnimationFrame(tick);
    }

    // ---- rendering ---------------------------------------------------------------------------

    function render(now, raw) {
        const notes =
            session.mode === "calibration" ? session.notes : scorer().notes;
        const pitches = heldPitches(),
            armed = session.practice?.current;
        // Only the approach window is inspected; the head skips judged and long-past notes.
        const missWindow = Math.max(
            600,
            timingOffset + (session.judge?.windows.meh ?? HIT_WINDOW),
        );
        while (
            session.visualHead < notes.length &&
            (notes[session.visualHead].grade ||
                notes[session.visualHead].timeMs < raw - missWindow)
        )
            session.visualHead++;
        const upcoming = stage.drawCues({
            notes,
            from: session.visualHead,
            raw,
            leadMs: session.leadMs,
            isSatisfied: (note) =>
                armed &&
                sameOnset(armed.timeMs, note.timeMs) &&
                armed.armed.has(note.note) &&
                pitches.has(note.note),
            nextRound: moreFollowRounds()
                ? {
                      startMs: session.deadlineMs + session.loop.gapMs,
                      notes: session.notes,
                  }
                : null,
        });
        stage.drawFlashes(now);
        stage.drawUpcoming(upcoming);
        byId("teach-time").textContent =
            `${formatClock(raw)} / ${formatClock(session.endMs)}`;
        if (session.mode === "lesson")
            scoreView.position(Math.max(0, raw) + session.plan.startMs);
        renderFeedback(now, raw);
    }

    function renderFeedback(now, raw) {
        if (session.resumeAt && now < session.resumeAt) {
            feedback(
                t("teach.feedback.resumeIn", {
                    seconds: Math.ceil((session.resumeAt - now) / 1000),
                }),
                now,
            );
        } else if (phase === "waiting") {
            const missing = session.practice.missing(heldPitches());
            for (const note of session.practice.current?.notes || [])
                if (!missing.includes(note.note))
                    stage.markSatisfied(note.note);
            feedback(
                t("teach.feedback.waiting", {
                    notes: missing.map(noteName).join(" + "),
                }),
                now,
            );
        } else if (raw < 0) {
            feedback(
                t("teach.feedback.countIn", {
                    seconds: Math.ceil(-raw / 1000),
                }),
                now,
            );
        } else if (now > feedbackUntil) {
            feedback(
                t(
                    session.mode === "calibration"
                        ? "teach.feedback.followFirstKey"
                        : "teach.feedback.follow",
                ),
                now + 200,
            );
        }
    }

    // ---- session lifecycle -------------------------------------------------------------------

    function endSession(clearFeedback = true) {
        cancelFrame();
        metronome.stop();
        stage.clear(clearFeedback);
        session = null;
        phase = "idle";
    }

    function moreFollowRounds() {
        return !!session?.loop && session.loop.round < session.loop.count;
    }

    function setupRound(origin) {
        session.origin = origin;
        session.pausedMs = 0;
        session.resumeAt = null;
        session.visualHead = 0;
        session.judge = session.follow
            ? null
            : new TeachingJudge(session.notes, { od: session.od });
        session.practice = session.follow
            ? new FollowPractice(session.notes)
            : null;
        session.pressFeedback = new Set();
        session.endMs = session.plan.durationMs;
        const lastNoteMs = session.notes.at(-1).timeMs;
        session.deadlineMs = session.follow
            ? session.endMs
            : Math.max(
                  session.endMs,
                  lastNoteMs + session.judge.windows.meh + timingOffset,
              );
        phase = "playing";
        stage.clear();
        score();
        controls();
        scheduleAudio();
    }

    function recordFollowRound(stopped) {
        return scoreView.recordFollowRound(
            session.loop.round,
            session.practice.result,
            stopped,
        );
    }

    function finish(stopped) {
        if (session?.mode === "lesson") {
            if (session.judge) session.judge.advance(Infinity);
            score();
            const result = session.practice
                ? recordFollowRound(stopped)
                : session.judge.result;
            showResults({
                result,
                follow: !!session.practice,
                stopped,
                context: t("teach.results.context", {
                    file: fileName,
                    tracks: new Intl.ListFormat(getLocale()).format(
                        session.plan.trackNames,
                    ),
                    bpm: byId("teach-bpm").value,
                }),
            });
            if (!session.practice)
                byId("teach-results").scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            feedback(
                t(
                    stopped
                        ? "teach.feedback.stopped"
                        : "teach.feedback.finished",
                ),
                Infinity,
            );
        }
        endSession(false);
        controls(t(stopped ? "teach.status.stopped" : "teach.status.finished"));
    }

    function completeFollowRound() {
        if (!moreFollowRounds()) {
            finish(false);
            return;
        }
        cancelFrame();
        recordFollowRound(false);
        // Late rounds start now rather than replaying a gap that has already passed.
        const now = performance.now(),
            boundary = session.origin + session.deadlineMs;
        const nextOrigin =
            (now - boundary > 100 ? now : boundary) + session.loop.gapMs;
        session.loop.round++;
        setupRound(nextOrigin);
        tick();
    }

    function saveTiming(value) {
        timingOffset = value;
        byId("teach-offset").value = value;
        preferences.set("teach:timing-offset", value);
        byId("teach-calibration-info").textContent = t(
            "teach.latency.current",
            { offset: formatSignedMs(value) },
        );
    }

    function finishCalibration() {
        const samples = session.samples.slice();
        endSession();
        try {
            saveTiming(calibrationOffset(samples));
            feedback(t("teach.feedback.calibrated"), Infinity);
            controls(t("teach.status.calibrated"));
        } catch {
            feedback(t("teach.feedback.recalibrate"), Infinity);
            controls(t("teach.status.tooFewTaps"));
        }
    }

    function stop() {
        mapping = false;
        if (session?.mode === "lesson") {
            finish(true);
            return;
        }
        endSession();
        feedback(t("teach.feedback.cancelled"), Infinity);
        controls();
    }

    function pause(status = t("teach.status.paused")) {
        if (phase === "calibrating" || phase === "preparing") {
            stop();
            return;
        }
        if (!["playing", "waiting"].includes(phase) || !session) return;
        const position = session.practice
            ? advanceFollow(performance.now())
            : elapsed();
        session.pausedMs = position;
        session.resumeAt = null;
        if (session.judge)
            session.judge
                .advance(position - timingOffset)
                .forEach((hit) => showHit(hit));
        score();
        phase = "paused";
        cancelFrame();
        metronome.stop();
        feedback(t("teach.feedback.paused"), Infinity);
        controls(status);
    }

    function calibrationChart() {
        const note = 60 + getOffset();
        return {
            notes: Array.from({ length: CALIBRATION_TAPS }, (_, i) => ({
                id: i,
                note,
                timeMs: i * CALIBRATION_INTERVAL_MS,
                grade: null,
            })),
            grid: {
                next: (ms) => {
                    const beat = Math.ceil(
                        ms / CALIBRATION_INTERVAL_MS - QUARTER_EPSILON,
                    );
                    return {
                        timeMs: beat * CALIBRATION_INTERVAL_MS,
                        accent: true,
                        beat: 1,
                    };
                },
            },
        };
    }

    function lessonChart() {
        if (!song) throw new AppError("errors.uploadFirst");
        scoreView.refresh(
            song,
            selectedTracks(),
            number("teach-bpm", "bpm"),
            true,
        );
        const plan = scoreView.plan();
        if (!plan.notes.length) throw new AppError("errors.noPracticeNotes");
        return { notes: plan.notes, grid: plan.grid, plan };
    }

    // A disconnect or tab change while awaiting audio must not start a stale run.
    const stillVisible = () => !document.hidden && !byId("panel-teach").hidden;

    async function begin(calibration = false) {
        if (locked() || loading) return;
        if (transport.state !== "ready")
            throw new AppError("errors.connectFirst");
        if (player.state !== "idle") throw new AppError("errors.stopPlayback");
        const leadMs = number("teach-lead", "lead") * 1000;
        const follow = !calibration && isFollowMode();
        const od = !calibration && !follow ? selectedDifficulty() : DEFAULT_OD;
        const chart = calibration ? calibrationChart() : lessonChart();
        mapping = false;
        phase = "preparing";
        controls();
        try {
            if (byId("teach-metronome").checked) await metronome.ready();
        } catch (error) {
            phase = "idle";
            controls();
            throw error;
        }
        if (
            phase !== "preparing" ||
            transport.state !== "ready" ||
            !stillVisible()
        ) {
            phase = "idle";
            controls();
            return;
        }
        setOffset(getOffset());
        const notes = colorTeachingNotes(chart.notes);
        session = {
            mode: calibration ? "calibration" : "lesson",
            notes,
            grid: chart.grid,
            leadMs,
            od,
            origin: performance.now() + Math.max(COUNT_IN_MS, leadMs + 500),
            pausedMs: 0,
            resumeAt: null,
            endMs:
                notes.at(-1).timeMs +
                (calibration ? CALIBRATION_WINDOW_MS : HIT_WINDOW),
            visualHead: 0,
            samples: [],
            judge: null,
            plan: chart.plan,
            loop: follow ? { ...chart.plan.loop, round: 1 } : null,
            follow,
        };
        phase = calibration ? "calibrating" : "playing";
        if (!calibration) {
            scoreView.resetHistory();
            setupRound(session.origin);
            preferences.set("teach:mode", follow ? "follow" : "rhythm");
            if (!follow) preferences.set("teach:od", od);
        }
        hideResults();
        stage.clear();
        resetScore(notes.length);
        preferences.set("teach:lead", leadMs / 1000);
        if (!calibration) score();
        byId("teach-keyboard")
            .closest(".teach-stage")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        controls();
        if (calibration) scheduleAudio();
        tick();
    }

    async function resume() {
        if (phase !== "paused" || !session) return;
        const canRun = () =>
            transport.state === "ready" && player.state === "idle";
        if (!canRun()) throw new AppError("errors.connectAndStop");
        const current = session;
        if (byId("teach-metronome").checked) await metronome.ready();
        if (
            session !== current ||
            phase !== "paused" ||
            !stillVisible() ||
            !canRun()
        )
            return;
        session.resumeAt = performance.now() + RESUME_COUNTDOWN_MS;
        session.origin = session.resumeAt - session.pausedMs;
        phase = "playing";
        controls();
        scheduleAudio();
        tick();
    }

    // ---- key input ---------------------------------------------------------------------------

    // Between rounds, the next round may be opened early by playing its first note.
    function opensNextFollowRound(event) {
        const first = session.notes[0];
        return session.notes.some(
            (note) =>
                sameOnset(note.timeMs, first.timeMs) &&
                note.note === event.note,
        );
    }

    function pressCalibration(event, receivedAt) {
        const raw = elapsed(receivedAt);
        const candidate = session.notes
            .filter(
                (note) =>
                    !note.grade &&
                    Math.abs(raw - note.timeMs) <= CALIBRATION_WINDOW_MS,
            )
            .sort(
                (a, b) => Math.abs(raw - a.timeMs) - Math.abs(raw - b.timeMs),
            )[0];
        if (!candidate || event.note !== candidate.note) return;
        candidate.grade = "Calibrated";
        session.samples.push(raw - candidate.timeMs);
        showHit({ ...candidate, errorMs: raw - candidate.timeMs });
        byId("teach-count").textContent =
            `${session.samples.length} / ${CALIBRATION_TAPS}`;
    }

    function pressFollow(event, receivedAt) {
        const beforePress = heldPitches();
        beforePress.delete(event.note);
        advanceFollow(receivedAt, beforePress);
        const target = session.practice.current?.notes.find(
            (note) => note.note === event.note,
        );
        showHit(session.practice.press(event.note));
        if (target) {
            session.pressFeedback.add(target.id);
            showHit({ ...target, grade: "Armed", errorMs: null });
        }
        advanceFollow(receivedAt, heldPitches(), true);
        score();
    }

    function pressRhythm(event, receivedAt) {
        const corrected = elapsed(receivedAt) - timingOffset;
        session.judge.advance(corrected).forEach((hit) => showHit(hit));
        showHit(session.judge.press(event.note, corrected));
        score();
    }

    function release(event) {
        held.delete(`${event.channel}:${event.note}`);
        if (!isHeld(event.note)) session?.practice?.release(event.note);
        stage.showHeld(heldPitches());
    }

    function receive(event, receivedAt = performance.now()) {
        if (event.kind === "note-off") return release(event);
        if (event.kind !== "note-on") return;
        const repeated = isHeld(event.note);
        held.set(`${event.channel}:${event.note}`, event.note);
        stage.showHeld(heldPitches());
        if (repeated) return;
        stage.burst(event.note);
        if (mapping) {
            setOffset(event.note - 60);
            mapping = false;
            mappingChanged();
            controls(t("teach.status.mapped"));
            return;
        }
        if (
            !session ||
            !active() ||
            phase === "preparing" ||
            (session.resumeAt && receivedAt < session.resumeAt)
        )
            return;
        if (
            moreFollowRounds() &&
            session.practice.complete &&
            opensNextFollowRound(event)
        )
            completeFollowRound();
        if (session.mode === "calibration") pressCalibration(event, receivedAt);
        else if (session.practice) pressFollow(event, receivedAt);
        else pressRhythm(event, receivedAt);
    }

    // ---- file and settings -------------------------------------------------------------------

    async function loadFile() {
        if (locked()) return;
        const file = byId("teach-file").files[0],
            request = ++fileRequest;
        if (!file) return;
        loading = true;
        song = null;
        mapping = false;
        controls();
        scoreView.refresh(null, [], 120);
        scoreView.resetHistory();
        byId("teach-tracks").replaceChildren();
        byId("teach-summary").textContent = t("common.readingMidi");
        hideResults();
        try {
            const parsed = await readMidiFile(file);
            if (request !== fileRequest) return;
            song = parsed;
            fileName = file.name;
            const first = renderTrackPicker(song.tracks);
            byId("teach-bpm").value = bpmValue(
                Math.min(1000, Math.max(1, song.initialBpm)),
            );
            scoreView.refresh(
                song,
                selectedTracks(),
                Number(byId("teach-bpm").value),
            );
            byId("teach-summary").textContent = t("teach.summary.loaded", {
                file: fileName,
                count: song.tracks.length,
                bpm: formatDecimal(song.initialBpm, 3),
            });
            feedback(
                t(first ? "teach.feedback.ready" : "teach.feedback.noNotes"),
                Infinity,
            );
        } catch (error) {
            byId("teach-summary").textContent = t("teach.summary.failed");
            throw error;
        } finally {
            if (request === fileRequest) {
                loading = false;
                controls();
            }
        }
    }

    async function toggleMetronome() {
        const enabled = byId("teach-metronome").checked;
        preferences.set("teach:metronome", enabled);
        metronome.stop();
        if (!enabled || !active() || !session) return;
        try {
            await metronome.ready();
            scheduleAudio();
        } catch (error) {
            byId("teach-metronome").checked = false;
            preferences.set("teach:metronome", false);
            throw error;
        }
    }

    function restoreSettings() {
        timingOffset = savedNumber("teach:timing-offset", 0, -1000, 1000);
        byId("teach-offset").value = timingOffset;
        byId("teach-lead").value = savedNumber("teach:lead", 1.5, 0.5, 3);
        byId("teach-volume").value = savedNumber("teach:volume", 35, 0, 100);
        byId("teach-metronome").checked =
            preferences.get("teach:metronome") === "true";
        metronome.volume = Number(byId("teach-volume").value) / 100;
        byId("teach-mode").value =
            preferences.get("teach:mode") === "follow" ? "follow" : "rhythm";
        renderDifficultyPicker(savedNumber("teach:od", DEFAULT_OD, 0, 10));
    }

    restoreSettings();
    mappingChanged();

    byId("teach-file").addEventListener("change", report(loadFile));
    byId("teach-start").addEventListener(
        "click",
        report(() => begin(false)),
    );
    byId("teach-calibrate").addEventListener(
        "click",
        report(() => begin(true)),
    );
    byId("teach-stop").addEventListener("click", stop);
    byId("teach-pause").addEventListener(
        "click",
        report(() => (phase === "paused" ? resume() : pause())),
    );
    byId("teach-map").addEventListener("click", () => {
        mapping = !mapping;
        controls();
    });
    byId("teach-apply-map").addEventListener(
        "click",
        report(() => {
            if (locked()) return;
            setOffset(number("teach-first-note", "firstNote") - 60);
            mapping = false;
            mappingChanged();
            controls();
        }),
    );
    byId("teach-apply-offset").addEventListener(
        "click",
        report(() => {
            if (!locked()) saveTiming(number("teach-offset", "timingOffset"));
        }),
    );
    byId("teach-reset-offset").addEventListener("click", () => {
        if (!locked()) saveTiming(0);
    });
    byId("teach-volume").addEventListener("input", () => {
        metronome.volume = Number(byId("teach-volume").value) / 100;
        preferences.set("teach:volume", byId("teach-volume").value);
    });
    byId("teach-metronome").addEventListener("change", report(toggleMetronome));
    for (const id of ["teach-tracks", "teach-bpm"])
        byId(id).addEventListener(
            "change",
            report(() => {
                if (locked() || !song) return;
                scoreView.refresh(
                    song,
                    selectedTracks(),
                    number("teach-bpm", "bpm"),
                    true,
                );
                discardResults();
                controls();
            }),
        );
    byId("teach-mode").addEventListener("change", () => {
        if (locked()) return;
        discardResults();
        controls();
    });
    byId("teach-difficulties").addEventListener(
        "change",
        report(() => {
            if (locked()) return;
            preferences.set("teach:od", selectedDifficulty());
            discardResults();
            controls();
        }),
    );
    for (const id of ["teach-loop-mode", "teach-loop-count", "teach-loop-gap"])
        byId(id).addEventListener("change", () => {
            if (!locked()) discardResults();
        });
    transport.addEventListener("status", () => {
        if (transport.state !== "ready") {
            held.clear();
            session?.practice?.clearHeld();
            stage.showHeld(heldPitches());
            mapping = false;
            pause(t("teach.status.disconnected"));
        }
        mappingChanged();
        controls();
    });
    player.addEventListener("state", () => {
        if (player.state !== "idle") pause(t("teach.status.playbackRunning"));
        controls();
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) return;
        mapping = false;
        pause(t("teach.status.hidden"));
    });
    window.addEventListener("pagehide", () => {
        cancelFrame();
        metronome.stop();
        stage.clear();
    });
    saveTiming(timingOffset);
    controls();
    return {
        receive,
        mappingChanged,
        pause,
        get busy() {
            return active();
        },
    };
}
