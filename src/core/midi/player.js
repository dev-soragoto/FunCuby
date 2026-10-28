import { commandMessages, encodePackets } from "../ble/protocol.js";
import { AppError, message } from "../message.js";
import {
    compilePerformance,
    performanceAt,
    performancePrograms,
    pitchKey,
    preparePerformance,
} from "./performance-plan.js";

export function performanceMessages(events) {
    return events.map((event) => [
        (event.on ? 0x90 : 0x80) | (event.channel - 1),
        event.note,
        event.velocity,
    ]);
}

function position(value, durationMs) {
    if (!Number.isFinite(value)) throw new AppError("errors.position");
    return Math.min(durationMs, Math.max(0, value));
}

function batches(events) {
    const groups = [];
    for (const event of events) {
        if (groups.at(-1)?.format !== event.format)
            groups.push({ format: event.format, events: [] });
        groups.at(-1).events.push(event);
    }
    return groups;
}

export class MidiPlayer extends EventTarget {
    constructor(
        transport,
        {
            now = () => performance.now(),
            setTimer = (callback, delay) =>
                globalThis.setTimeout(callback, delay),
            clearTimer = (timer) => globalThis.clearTimeout(timer),
        } = {},
    ) {
        super();
        this.transport = transport;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.state = "idle";
        this.session = null;
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    progress(session) {
        this.emit("progress", {
            elapsedMs: Math.min(
                session.durationMs,
                Math.max(0, this.now() - session.start),
            ),
            durationMs: session.durationMs,
        });
    }

    changeState(state) {
        this.state = state;
        this.emit("state", { state });
    }

    play(song, settings, { startMs = 0 } = {}) {
        if (this.state !== "idle") throw new AppError("errors.stopPlayback");
        if (this.transport.state !== "ready")
            throw new AppError("errors.connectFirst");
        const source = preparePerformance(song, settings);
        if (!source.some((event) => event.on))
            throw new AppError("errors.noTrackNotes");
        const programs = performancePrograms(source);
        const durationMs = Math.max(
            song.durationMs,
            source.at(-1)?.timeMs || 0,
        );
        const offset = position(startMs, durationMs);
        const { events, skipped } = compilePerformance(source);
        const session = {
            source,
            events,
            programs,
            offset,
            durationMs,
            start: this.now() - offset,
            index: 0,
            seekTarget: offset > 0 ? offset : null,
            generation: this.transport.generation,
            job: this.transport.job,
            active: new Map(),
            stopped: false,
            releasing: false,
            initializing: true,
            wake: /** @type {(() => void) | null} */ (null),
        };
        this.session = session;
        this.changeState("playing");
        this.emit("timing", { skipped });
        this.completion = this.perform(session).finally(() => {
            this.session = null;
            this.changeState("idle");
        });
        return this.completion;
    }

    async waitUntil(session, timeMs) {
        while (
            !session.stopped &&
            session.seekTarget === null &&
            this.now() - session.start < timeMs
        ) {
            this.progress(session);
            await new Promise((resolve) => {
                const timer = this.setTimer(
                    () => {
                        session.wake = null;
                        resolve();
                    },
                    Math.min(50, timeMs - (this.now() - session.start)),
                );
                session.wake = () => {
                    this.clearTimer(timer);
                    session.wake = null;
                    resolve();
                };
            });
        }
    }

    seek(timeMs) {
        const session = this.session;
        if (!session || session.stopped) return;
        session.seekTarget = position(timeMs, session.durationMs);
        if (!session.releasing && !session.initializing)
            this.transport.cancel();
        session.wake?.();
    }

    async stop() {
        if (!this.session) return;
        if (!this.session.stopped) {
            this.session.stopped = true;
            this.changeState("stopping");
            if (!this.session.releasing) this.transport.cancel();
            this.session.wake?.();
        }
        await this.completion;
    }

    async write(session, events, format, label) {
        const packets = encodePackets(performanceMessages(events), {
            format,
            timestamp: Math.floor(this.now()),
        });
        const job = this.transport.job;
        await this.transport.send(packets, label);
        if (
            job !== this.transport.job ||
            this.transport.generation !== session.generation
        )
            return false;
        for (const event of events) {
            if (event.on) session.active.set(pitchKey(event), event);
            else session.active.delete(pitchKey(event));
        }
        return true;
    }

    async releaseActive(session, label) {
        if (
            this.transport.state !== "ready" ||
            this.transport.generation !== session.generation ||
            !session.active.size
        )
            return;
        const releases = [...session.active.values()].map((event) => ({
            ...event,
            on: false,
            velocity: 0,
        }));
        session.releasing = true;
        try {
            for (const batch of batches(releases))
                await this.write(session, batch.events, batch.format, label);
        } finally {
            session.releasing = false;
        }
    }

    async sendEvents(session, group) {
        for (const batch of batches(group)) {
            if (session.stopped || session.seekTarget !== null) return;
            // Remember attempted presses so partial write failures can be cleaned up.
            for (const event of batch.events)
                if (event.on) session.active.set(pitchKey(event), event);
            await this.write(
                session,
                batch.events,
                batch.format,
                message("tx.playback"),
            );
            if (
                session.stopped ||
                session.seekTarget !== null ||
                this.transport.job !== session.job
            )
                return;
        }
    }

    async initializePrograms(session) {
        const valid = () =>
            !session.stopped &&
            this.transport.state === "ready" &&
            this.transport.generation === session.generation &&
            this.transport.job === session.job;
        for (const batch of batches(session.programs)) {
            if (!valid()) return false;
            const messages = batch.events.flatMap((event) =>
                commandMessages({
                    command: "program",
                    channel: event.channel,
                    program: event.program,
                }),
            );
            await this.transport.send(
                encodePackets(messages, {
                    format: batch.format,
                    timestamp: Math.floor(this.now()),
                }),
                message("tx.setPrograms"),
            );
        }
        return valid();
    }

    async perform(session) {
        let failure;
        try {
            if (!(await this.initializePrograms(session)))
                session.stopped = true;
            session.initializing = false;
            session.start = this.now() - session.offset;
            while (!session.stopped) {
                if (session.seekTarget !== null) {
                    await this.releaseActive(
                        session,
                        message("tx.seekRelease"),
                    );
                    if (session.stopped) break;
                    if (
                        this.transport.state !== "ready" ||
                        this.transport.generation !== session.generation
                    ) {
                        session.stopped = true;
                        break;
                    }
                    const target = session.seekTarget;
                    session.seekTarget = null;
                    const { index, held } =
                        target === 0
                            ? { index: 0, held: [] }
                            : performanceAt(
                                  session.source,
                                  session.events,
                                  target,
                              );
                    session.index =
                        target >= session.durationMs
                            ? session.events.length
                            : index;
                    session.job = this.transport.job;
                    session.start = this.now() - target;
                    if (target < session.durationMs && held.length)
                        await this.sendEvents(session, held);
                    if (session.stopped || session.seekTarget !== null)
                        continue;
                    session.start = this.now() - target;
                    this.progress(session);
                }
                if (session.index >= session.events.length) {
                    await this.waitUntil(session, session.durationMs);
                    if (session.seekTarget !== null) continue;
                    await this.releaseActive(session, message("tx.endRelease"));
                    if (!session.stopped && session.seekTarget !== null)
                        continue;
                    break;
                }
                const at = session.events[session.index].timeMs;
                await this.waitUntil(session, at);
                if (session.stopped) break;
                if (session.seekTarget !== null) continue;
                if (
                    this.transport.generation !== session.generation ||
                    this.transport.job !== session.job
                ) {
                    session.stopped = true;
                    break;
                }
                const group = [];
                do {
                    group.push(session.events[session.index++]);
                } while (
                    session.index < session.events.length &&
                    session.events[session.index].timeMs === at
                );
                await this.sendEvents(session, group);
                if (session.seekTarget !== null) continue;
                if (session.stopped || this.transport.job !== session.job) {
                    session.stopped = true;
                    break;
                }
                this.progress(session);
            }
        } catch (error) {
            failure = error;
        } finally {
            session.initializing = false;
            try {
                await this.releaseActive(session, message("tx.endRelease"));
            } catch (error) {
                failure ||= error;
            }
            session.active.clear();
            this.progress(session);
        }
        if (failure) throw failure;
        this.emit("ended", { stopped: session.stopped });
    }
}
