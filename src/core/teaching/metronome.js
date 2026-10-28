import { AppError } from "../message.js";

// Schedule short synthesized clicks against the same performance clock as the rings.
export class TeachingMetronome {
    constructor(onSuspended) {
        this.context = null;
        this.nodes = new Set();
        this.timer = null;
        this.volume = 0.35;
        this.onSuspended = onSuspended;
    }

    async ready() {
        if (!this.context) {
            const Audio =
                globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!Audio) throw new AppError("errors.noWebAudio");
            this.context = new Audio();
            this.context.addEventListener("statechange", () => {
                if (this.context.state !== "running" && this.timer !== null)
                    this.onSuspended();
            });
        }
        if (this.context.state !== "running") await this.context.resume();
        if (this.context.state !== "running")
            throw new AppError("errors.metronomeBlocked");
    }

    start({ origin, grid, startMs, endMs }) {
        this.stop();
        let cursor = startMs;
        const schedule = () => {
            const now = performance.now(),
                elapsed = now - origin;
            // Never catch up missed clicks in a burst after a delayed callback.
            cursor = Math.max(cursor, elapsed - 5);
            for (let i = 0; i < 128; i++) {
                const beat = grid.next(cursor);
                const limit = typeof endMs === "function" ? endMs() : endMs;
                if (beat.timeMs > elapsed + 100 || beat.timeMs > limit) break;
                const when =
                    this.context.currentTime +
                    Math.max(0, (origin + beat.timeMs - now) / 1000);
                this.click(when, beat.accent);
                cursor = beat.timeMs + 0.01;
            }
        };
        schedule();
        this.timer = globalThis.setInterval(schedule, 25);
    }

    click(when, accent) {
        const oscillator = this.context.createOscillator(),
            gain = this.context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = accent ? 1200 : 800;
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(
            this.volume * (accent ? 0.24 : 0.16),
            when + 0.002,
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        this.nodes.add(oscillator);
        oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
            this.nodes.delete(oscillator);
        };
        oscillator.start(when);
        oscillator.stop(when + 0.05);
    }

    stop() {
        if (this.timer !== null) globalThis.clearInterval(this.timer);
        this.timer = null;
        for (const node of this.nodes) {
            try {
                node.stop();
            } catch {
                /* Already ended. */
            }
        }
        this.nodes.clear();
    }
}
