export class ScreenWakeLock {
    constructor({
        document = globalThis.document,
        window = globalThis.window,
        wakeLock = globalThis.navigator?.wakeLock,
        secure = globalThis.isSecureContext,
        setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
        clearTimer = (id) => globalThis.clearTimeout(id),
    } = {}) {
        this.document = document;
        this.window = window;
        this.wakeLock = wakeLock;
        this.supported = !!secure && typeof wakeLock?.request === "function";
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.lease = null;
        this.pending = null;
        this.generation = 0;
        this.timer = null;
        this.started = false;
        this.pageActive = true;
        this.retryBudget = 1;
        this.onVisibility = () => {
            if (document.hidden) this.releaseCurrent();
            else {
                this.retryBudget = 1;
                this.request();
            }
        };
        this.onPageHide = () => {
            this.pageActive = false;
            this.releaseCurrent();
        };
        this.onPageShow = () => {
            this.pageActive = true;
            this.retryBudget = 1;
            this.request();
        };
        this.onInteraction = () => {
            if (!this.lease && !this.pending) {
                this.retryBudget = 1;
                this.request();
            }
        };
    }

    get visible() {
        return this.started && this.pageActive && !this.document.hidden;
    }

    start() {
        if (this.started) return this.request();
        this.started = true;
        if (this.supported) {
            this.document.addEventListener(
                "visibilitychange",
                this.onVisibility,
            );
            this.document.addEventListener("pointerdown", this.onInteraction);
            this.document.addEventListener("keydown", this.onInteraction);
            this.window.addEventListener("pagehide", this.onPageHide);
            this.window.addEventListener("pageshow", this.onPageShow);
        }
        return this.request();
    }

    clearRetry() {
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null;
    }

    async releaseLease(lease) {
        try {
            await lease?.release();
        } catch {
            /* The browser may already have released it. */
        }
    }

    releaseCurrent() {
        this.generation++;
        this.clearRetry();
        const lease = this.lease;
        this.lease = null;
        void this.releaseLease(lease);
    }

    request() {
        if (!this.supported) return Promise.resolve(null);
        if (!this.visible) return Promise.resolve(null);
        if (this.lease && !this.lease.released)
            return Promise.resolve(this.lease);
        if (this.pending) return this.pending.promise;
        this.clearRetry();
        const token = { generation: this.generation };
        this.pending = token;
        token.promise = this.acquire(token);
        return token.promise;
    }

    async acquire(token) {
        try {
            const lease = await this.wakeLock.request("screen");
            // A request may finish after the page has hidden, closed or been restored.
            if (!this.visible || token.generation !== this.generation) {
                await this.releaseLease(lease);
                return null;
            }
            if (lease.released) return null;
            this.lease = lease;
            lease.addEventListener(
                "release",
                () => {
                    if (this.lease !== lease) return;
                    this.lease = null;
                    if (!this.visible) return;
                    // A single automatic retry avoids a loop under persistent power restrictions.
                    if (this.retryBudget > 0) {
                        this.retryBudget--;
                        this.timer = this.setTimer(() => {
                            this.timer = null;
                            this.request();
                        }, 500);
                    }
                },
                { once: true },
            );
            return lease;
        } catch {
            return null;
        } finally {
            if (this.pending === token) this.pending = null;
            if (
                this.visible &&
                token.generation !== this.generation &&
                !this.lease
            )
                this.request();
        }
    }
}

export function initScreenWakeLock() {
    const controller = new ScreenWakeLock();
    controller.start();
    return controller;
}
